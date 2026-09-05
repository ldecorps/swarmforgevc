'use strict';

// BL-1402 declared invariants (BL-654: coder-authored property tests, one
// per declared invariant, in this parcel):
//
// 1. A photo that cannot be kept never blocks its caption: on any fetch
//    failure (getFile, download, size cap) the caption routes with text
//    byte-identical to today's, one audit line names the update id and the
//    reason and never content, and no file is written.
// 2. BL-620's statement stays on every forwarding surface, byte-identical -
//    keeping the bytes on disk never implies the front desk read the image;
//    the saved path rides on its own line after that note.
// 3. The media store is bounded and idempotent: a redelivered update never
//    writes a second file for the same update id, and the store never
//    grows past its bound (oldest files go first).
//
// Invariant 1 and 2 drive the REAL dispatch (runPollCycle ->
// processMessageUpdate) so the assertion is against the actual routed text
// and the actual injected audit sink, never a rebuilt string. Invariant 3
// drives the REAL persistRoutedPhoto/store against a real temp directory.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { persistRoutedPhoto, ROUTED_PHOTO_STORE_BOUND } = require('../out/tools/telegram-front-desk-bot');
const { runPollCycle, annotateRoutedMediaText } = require('../out/tools/telegramFrontDeskBotCore');

const PRINCIPAL_ID = 111;
const BACKOFF_CONFIG = {
  backoffBaseMs: 1000,
  backoffMaxMs: 8000,
  degradedThreshold: 3,
  sustainedOutageThresholdMs: 30 * 60_000,
};
const NO_OUTAGE = { escalated: false };
const MAX_TELEGRAM_PHOTO_BYTES = 8 * 1024 * 1024;

function mkPhotoUpdate(updateId, caption) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      chat: { id: 1 },
      from: { id: PRINCIPAL_ID },
      message_thread_id: 7,
      photo: [{ file_id: 'photo-1', width: 90, height: 60 }],
      caption,
    },
  };
}

function successDeps() {
  return {
    getFileFn: async () => ({ success: true, filePath: 'photos/file.jpg' }),
    downloadFn: async () => ({ success: true, bytes: Buffer.from('bytes') }),
  };
}

function failureDeps(kind) {
  if (kind === 'getFileFail') {
    return { getFileFn: async () => ({ success: false, error: 'boom-getfile' }) };
  }
  if (kind === 'downloadFail') {
    return {
      getFileFn: async () => ({ success: true, filePath: 'photos/file.jpg' }),
      downloadFn: async () => ({ success: false, error: 'boom-download' }),
    };
  }
  // sizeCap
  return {
    getFileFn: async () => ({ success: true, filePath: 'photos/file.jpg' }),
    downloadFn: async () => ({ success: true, bytes: Buffer.alloc(MAX_TELEGRAM_PHOTO_BYTES + 1) }),
  };
}

async function routeThroughCore(update, caption, photoOutcome) {
  const opened = [];
  const auditLines = [];
  await runPollCycle(
    { offset: 0, consecutiveFailures: 0, sustainedOutage: NO_OUTAGE },
    PRINCIPAL_ID,
    {
      chatId: '1',
      getUpdates: async () => ({ success: true, updates: [update] }),
      postToBridge: async () => true,
      subjectForTopic: () => undefined,
      openSubjectAndRecord: async (topicId, text) => {
        opened.push(text);
        return 'SUP-1';
      },
      persistRoutedPhoto: async () => photoOutcome,
      logDropAudit: (line) => auditLines.push(line),
    },
    BACKOFF_CONFIG,
    0
  );
  return { opened, auditLines };
}

// ── invariant 1 ──────────────────────────────────────────────────────────

test('property (invariant 1): a fetch failure never blocks the caption, writes no file, and logs exactly one audit line naming id and reason, never content', async () => {
  const seen = { getFileFail: 0, downloadFail: 0, sizeCap: 0 };
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom('getFileFail', 'downloadFail', 'sizeCap'),
      fc.string({ minLength: 1, maxLength: 30 }).map((s) => `caption-${s}`),
      fc.integer({ min: 1, max: 1_000_000 }),
      async (failureKind, caption, updateId) => {
        seen[failureKind] += 1;
        const root = mkTmpDir('sfvc-bl1402-inv1-');
        try {
          const update = mkPhotoUpdate(updateId, caption);
          const outcome = await persistRoutedPhoto('token', root, update, failureDeps(failureKind));
          assert.equal(outcome.kind, 'failed', `expected a failed outcome for ${failureKind}`);
          assert.ok(outcome.reason && outcome.reason.length > 0);
          assert.equal(
            fs.existsSync(path.join(root, '.swarmforge', 'operator', 'media')),
            false,
            'no file (nor even the media dir) must be created on a fetch failure'
          );

          const { opened, auditLines } = await routeThroughCore(update, caption, outcome);
          assert.equal(opened.length, 1);
          assert.equal(
            opened[0],
            annotateRoutedMediaText(caption, update),
            'the routed text must stay byte-identical to the pre-BL-1402 annotation on a persist failure'
          );
          assert.equal(auditLines.length, 1, `expected exactly one audit line, got: ${JSON.stringify(auditLines)}`);
          assert.ok(auditLines[0].includes(String(updateId)), `audit line must name the update id: ${auditLines[0]}`);
          assert.equal(auditLines[0].includes(caption), false, 'the audit line must never carry message content');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 20 }
  );
  assert.ok(
    seen.getFileFail >= 1 && seen.downloadFail >= 1 && seen.sizeCap >= 1,
    `generator never reached all three failure kinds invariant 1 names: ${JSON.stringify(seen)}`
  );
});

// ── invariant 2 ──────────────────────────────────────────────────────────

test("property (invariant 2): BL-620's note is byte-identical on every photo-persist outcome, and a saved path always rides its own line after it", async () => {
  const seen = { saved: 0, 'already-saved': 0, failed: 0, 'not-applicable': 0 };
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 30 }).map((s) => `caption-${s}`),
      fc.constantFrom('saved', 'already-saved', 'failed', 'not-applicable'),
      fc.string({ minLength: 1, maxLength: 20 }).map((s) => `.swarmforge/operator/media/${s}.jpg`),
      fc.integer({ min: 1, max: 1_000_000 }),
      async (caption, kind, savedPath, updateId) => {
        seen[kind] += 1;
        const update = mkPhotoUpdate(updateId, caption);
        const outcome =
          kind === 'saved' || kind === 'already-saved'
            ? { kind, path: savedPath }
            : kind === 'failed'
              ? { kind, reason: 'some reason' }
              : { kind: 'not-applicable' };

        const { opened } = await routeThroughCore(update, caption, outcome);
        assert.equal(opened.length, 1);
        const text = opened[0];
        const expectedNote = annotateRoutedMediaText(caption, update);
        assert.ok(text.startsWith(expectedNote), `the routed text must always start with BL-620's exact note: ${text}`);

        if (kind === 'saved' || kind === 'already-saved') {
          assert.equal(text, `${expectedNote}\n[image saved: ${savedPath}]`, 'the saved path must ride its own line right after the note');
        } else {
          assert.equal(text, expectedNote, `a ${kind} outcome must never add a saved-path line`);
        }
      }
    ),
    { numRuns: 25 }
  );
  assert.ok(
    seen.saved >= 1 && seen['already-saved'] >= 1 && seen.failed >= 1 && seen['not-applicable'] >= 1,
    `generator never reached all four outcome kinds: ${JSON.stringify(seen)}`
  );
});

// ── invariant 3 ──────────────────────────────────────────────────────────

test('property (invariant 3): the media store never exceeds its bound (oldest-first pruning), and a redelivered update never writes a second file', async () => {
  const seen = { pruned: 0, redelivered: 0 };
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: ROUTED_PHOTO_STORE_BOUND - 5, max: ROUTED_PHOTO_STORE_BOUND + 10 }),
      fc.integer({ min: 1, max: 100_000 }),
      fc.boolean(),
      async (preCount, updateId, redeliver) => {
        const root = mkTmpDir('sfvc-bl1402-inv3-');
        try {
          const dir = path.join(root, '.swarmforge', 'operator', 'media');
          fs.mkdirSync(dir, { recursive: true });
          const seedIds = [];
          for (let i = 0; i < preCount; i++) {
            const id = 500_000 + i;
            seedIds.push(id);
            const p = path.join(dir, `${id}.jpg`);
            fs.writeFileSync(p, 'x');
            const t = new Date(Date.now() - (preCount - i) * 1000);
            fs.utimesSync(p, t, t);
          }

          const deps = successDeps();
          const first = await persistRoutedPhoto('token', root, mkPhotoUpdate(updateId, 'cap'), deps);
          assert.equal(first.kind, 'saved');
          const namesAfterFirst = fs.readdirSync(dir);
          assert.ok(
            namesAfterFirst.length <= ROUTED_PHOTO_STORE_BOUND,
            `store exceeded its bound: ${namesAfterFirst.length} > ${ROUTED_PHOTO_STORE_BOUND}`
          );

          if (preCount + 1 > ROUTED_PHOTO_STORE_BOUND) {
            seen.pruned += 1;
            assert.equal(namesAfterFirst.length, ROUTED_PHOTO_STORE_BOUND, 'the store must hold exactly its bound after a prune');
            const survivingSeed = seedIds.filter((id) => namesAfterFirst.includes(`${id}.jpg`));
            const removedSeed = seedIds.filter((id) => !namesAfterFirst.includes(`${id}.jpg`));
            if (removedSeed.length > 0 && survivingSeed.length > 0) {
              assert.ok(
                Math.max(...removedSeed) <= Math.min(...survivingSeed),
                'a newer seed file was pruned ahead of an older one - pruning is not oldest-first'
              );
            }
          }

          if (redeliver) {
            seen.redelivered += 1;
            const second = await persistRoutedPhoto('token', root, mkPhotoUpdate(updateId, 'cap'), deps);
            assert.equal(second.kind, 'already-saved');
            assert.equal(second.path, first.path);
            const namesAfterSecond = fs.readdirSync(dir);
            assert.equal(namesAfterSecond.length, namesAfterFirst.length, 'a redelivery must never change the store size');
          }
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 30 }
  );
  assert.ok(seen.pruned >= 1, 'generator never reached the over-bound prune case');
  assert.ok(seen.redelivered >= 1, 'generator never reached a redelivery');
});
