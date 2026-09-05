'use strict';

// BL-1402: step handlers for "The front desk keeps a routed photo so the
// operator can see it".
//
// Drives the REAL front-desk dispatch (runPollCycle -> processMessageUpdate)
// with the REAL persistRoutedPhoto store/prune/idempotency logic behind it,
// against a real temp directory. Telegram's own two-step getFile -> GET is
// faked via persistRoutedPhoto's injectable deps (the same
// DownloadTelegramPhotoDeps convention cursorBridgeTelegramMedia.ts already
// uses) - never a real network call and never a real bot token.
//
// Fixture roots come from mkProcessTmpDir: the acceptance runner has no Vitest
// afterEach, so a root registered for that sweep would leak. Removal is
// registered on process exit instead - no hook that never fires, and no
// prefix-glob sweep that would delete a concurrent run's fixtures (BL-1390).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');
const { runPollCycle } = require('../../../extension/out/tools/telegramFrontDeskBotCore');
const { persistRoutedPhoto, ROUTED_PHOTO_STORE_BOUND } = require('../../../extension/out/tools/telegram-front-desk-bot');

const FEATURE = 'BL-1402 The front desk keeps a routed photo so the operator can see it';

const PRINCIPAL_ID = 111;
const BACKOFF_CONFIG = {
  backoffBaseMs: 1000,
  backoffMaxMs: 8000,
  degradedThreshold: 3,
  sustainedOutageThresholdMs: 30 * 60_000,
};
const NO_OUTAGE = { escalated: false };
const MEDIA_DIR = ['.swarmforge', 'operator', 'media'];
const FIXTURE_CAPTION = 'route these words';
const FIXTURE_BYTES = 'fixture-photo-bytes';
const UPDATE_ID = 100;

function mediaDir(root) {
  return path.join(root, ...MEDIA_DIR);
}

function ensureCtx(ctx) {
  if (!ctx.bl1402) {
    ctx.bl1402 = {
      root: mkProcessTmpDir('aps-bl1402-'),
      updateId: UPDATE_ID,
      caption: FIXTURE_CAPTION,
      failureKind: undefined,
      opened: [],
      posted: [],
      auditLines: [],
      deliveryCount: 0,
      oldestSeedId: undefined,
      mtimeAfterFirst: undefined,
    };
  }
  return ctx.bl1402;
}

// Scenario Outline values are load-bearing: each maps to a REAL failure mode
// persistRoutedPhoto would see, so the assertion is about the actual failure
// path rather than a passthrough of the example text (KNOWN_VALUES, no
// binary check).
const KNOWN_FAILURES = {
  'the file lookup fails': 'getFileFail',
  'the download fails': 'downloadFail',
  'the photo exceeds the size cap': 'sizeCap',
};

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

function fakeDepsFor(failureKind) {
  if (!failureKind) {
    return {
      getFileFn: async () => ({ success: true, filePath: 'photos/file.jpg' }),
      downloadFn: async () => ({ success: true, bytes: Buffer.from(FIXTURE_BYTES) }),
    };
  }
  if (failureKind === 'getFileFail') {
    return { getFileFn: async () => ({ success: false, error: 'fixture getFile failure' }) };
  }
  if (failureKind === 'downloadFail') {
    return {
      getFileFn: async () => ({ success: true, filePath: 'photos/file.jpg' }),
      downloadFn: async () => ({ success: false, error: 'fixture download failure' }),
    };
  }
  // sizeCap
  return {
    getFileFn: async () => ({ success: true, filePath: 'photos/file.jpg' }),
    downloadFn: async () => ({ success: true, bytes: Buffer.alloc(8 * 1024 * 1024 + 1) }),
  };
}

async function routeOneUpdate(state) {
  const update = mkPhotoUpdate(state.updateId, state.caption);
  state.deliveryCount += 1;
  await runPollCycle(
    { offset: 0, consecutiveFailures: 0, sustainedOutage: NO_OUTAGE },
    PRINCIPAL_ID,
    {
      chatId: '1',
      getUpdates: async () => ({ success: true, updates: [update] }),
      postToBridge: async () => true,
      subjectForTopic: () => undefined,
      openSubjectAndRecord: async (topicId, text) => {
        state.opened.push(topicId);
        state.posted.push(text);
        return 'SUP-1';
      },
      persistRoutedPhoto: (u) => persistRoutedPhoto('fixture-token', state.root, u, fakeDepsFor(state.failureKind)),
      logDropAudit: (line) => state.auditLines.push(line),
    },
    BACKOFF_CONFIG,
    0
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a front-desk bot bound to its own group with the principal configured$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^an operator media store for the front desk$/, (ctx) => {
    fs.mkdirSync(mediaDir(ensureCtx(ctx).root), { recursive: true });
  });

  scoped(/^the principal sends a photo whose caption carries the message words$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^fetching the photo fails because (.+)$/, (ctx, failure) => {
    const state = ensureCtx(ctx);
    const known = KNOWN_FAILURES[failure.trim()];
    assert.ok(known, `unknown failure example "${failure}" - add it to KNOWN_FAILURES rather than passing it through`);
    state.failureKind = known;
  });

  scoped(/^the media store already holds its bound of older files$/, (ctx) => {
    const state = ensureCtx(ctx);
    fs.mkdirSync(mediaDir(state.root), { recursive: true });
    for (let i = 0; i < ROUTED_PHOTO_STORE_BOUND; i++) {
      const id = 1000 + i;
      const p = path.join(mediaDir(state.root), `${id}.jpg`);
      fs.writeFileSync(p, 'old-bytes');
      const t = new Date(Date.now() - (ROUTED_PHOTO_STORE_BOUND - i) * 1000);
      fs.utimesSync(p, t, t);
    }
    state.oldestSeedId = 1000;
  });

  scoped(/^the front desk routes the message$/, async (ctx) => {
    await routeOneUpdate(ensureCtx(ctx));
  });

  scoped(/^the same update is delivered a second time$/, (ctx) => {
    ensureCtx(ctx); // no-op marker; "routes both deliveries" below drives it
  });

  scoped(/^the front desk routes both deliveries$/, async (ctx) => {
    const state = ensureCtx(ctx);
    await routeOneUpdate(state);
    state.mtimeAfterFirst = fs.statSync(path.join(mediaDir(state.root), `${state.updateId}.jpg`)).mtimeMs;
    await routeOneUpdate(state);
  });

  scoped(/^a file named by the update id sits in the media store with the photo's bytes$/, (ctx) => {
    const state = ensureCtx(ctx);
    const p = path.join(mediaDir(state.root), `${state.updateId}.jpg`);
    assert.ok(fs.existsSync(p), `expected a file at ${p}`);
    assert.equal(fs.readFileSync(p).toString(), FIXTURE_BYTES);
  });

  scoped(/^the routed text notes the attached image was not read by the front desk$/, (ctx) => {
    const state = ensureCtx(ctx);
    const text = state.posted[state.posted.length - 1];
    assert.match(text, /image.*not read/i);
  });

  scoped(/^the routed text names the saved file's path on its own line$/, (ctx) => {
    const state = ensureCtx(ctx);
    const text = state.posted[state.posted.length - 1];
    const expectedPath = path.posix.join(...MEDIA_DIR, `${state.updateId}.jpg`);
    assert.ok(
      text.split('\n').includes(`[image saved: ${expectedPath}]`),
      `routed text did not name the saved path on its own line: ${JSON.stringify(text)}`
    );
  });

  scoped(/^the routed text is exactly the text routed before this feature$/, (ctx) => {
    const state = ensureCtx(ctx);
    const text = state.posted[state.posted.length - 1];
    assert.equal(text, `${state.caption}\n[image attached - not read by the front desk]`);
  });

  scoped(/^one audit line names the update id and the reason$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.equal(state.auditLines.length, 1, `expected exactly one audit line, got: ${JSON.stringify(state.auditLines)}`);
    assert.ok(state.auditLines[0].includes(String(state.updateId)), `audit line must name the update id: ${state.auditLines[0]}`);
    assert.equal(state.auditLines[0].includes(state.caption), false, 'the audit line must never carry message content');
  });

  scoped(/^no file is written to the media store$/, (ctx) => {
    const state = ensureCtx(ctx);
    const p = path.join(mediaDir(state.root), `${state.updateId}.jpg`);
    assert.equal(fs.existsSync(p), false, `a file was written despite the fetch failure: ${p}`);
  });

  scoped(/^exactly one file for that update id sits in the media store$/, (ctx) => {
    const state = ensureCtx(ctx);
    const names = fs.readdirSync(mediaDir(state.root)).filter((n) => n.startsWith(`${state.updateId}.`));
    assert.equal(names.length, 1, `expected exactly one file for update id ${state.updateId}, got: ${JSON.stringify(names)}`);
  });

  scoped(/^it was written once$/, (ctx) => {
    const state = ensureCtx(ctx);
    const mtimeAfterSecond = fs.statSync(path.join(mediaDir(state.root), `${state.updateId}.jpg`)).mtimeMs;
    assert.equal(mtimeAfterSecond, state.mtimeAfterFirst, 'the file must not be rewritten on redelivery');
  });

  scoped(/^the media store holds exactly its bound of files$/, (ctx) => {
    const state = ensureCtx(ctx);
    const names = fs.readdirSync(mediaDir(state.root));
    assert.equal(names.length, ROUTED_PHOTO_STORE_BOUND, `expected exactly ${ROUTED_PHOTO_STORE_BOUND} files, got ${names.length}`);
  });

  scoped(/^the oldest file is gone and the new file is present$/, (ctx) => {
    const state = ensureCtx(ctx);
    const names = fs.readdirSync(mediaDir(state.root));
    assert.equal(names.includes(`${state.oldestSeedId}.jpg`), false, 'the oldest file must be gone');
    assert.equal(names.includes(`${state.updateId}.jpg`), true, 'the new file must be present');
  });
}

module.exports = { registerSteps };
