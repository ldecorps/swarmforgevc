const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  deliverRoleAnswer,
  roleAnswerFilePointerPath,
  roleAwaitingFilePointerPath,
  enqueueRoleAnswerNote,
} = require('../out/tools/telegram-front-desk-bot');

// BL-1201: a recorded human answer must name the question it answers, and
// a role must never consume one it cannot match to its own currently
// pending question. Companion to the BL-607/BL-1203 enqueueRoleAnswerNote
// tests in telegramFrontDeskBotCli.test.js.

function writeAwaiting(root, role, record) {
  const abs = path.join(root, roleAwaitingFilePointerPath(role));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(record));
}

function writeAnswer(root, role, record) {
  const abs = path.join(root, roleAnswerFilePointerPath(role));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(record));
}

function readAnswer(root, role) {
  return JSON.parse(fs.readFileSync(path.join(root, roleAnswerFilePointerPath(role)), 'utf8'));
}

function awaitingExists(root, role) {
  return fs.existsSync(path.join(root, roleAwaitingFilePointerPath(role)));
}

// ── scenario 01: mismatch is refused, pending question stays pending ──────

test('BL-1201: an answer whose askedAtMs does not match the pending question is reported as a mismatch, and the question stays pending', () => {
  const root = mkTmpDir('sfvc-bl1201-');
  writeAwaiting(root, 'specifier', { question: 'detached master checkout - what now?', asked_at_ms: 2000 });
  writeAnswer(root, 'specifier', { text: 'archive in-repo, nothing deleted', recordedAt: '2026-08-22T17:01:36Z', askedAtMs: 1000 });

  const result = deliverRoleAnswer(root, 'specifier');

  assert.equal(result.kind, 'mismatch');
  assert.equal(awaitingExists(root, 'specifier'), true, 'the pending question must still be pending after a mismatch');
  const stored = readAnswer(root, 'specifier');
  assert.equal(stored.consumedAt, undefined, 'a mismatched answer must not be marked consumed');
  assert.equal(stored.text, 'archive in-repo, nothing deleted', 'no answer text is destroyed by a mismatch');
});

// This exact incident, replayed directly (qa_e2e_procedure step 5): a
// five-day-old answer with no askedAtMs at all (pre-BL-1201 shape),
// against a live, different pending question.
test('BL-1201 incident replay: a pre-BL-1201 answer with no askedAtMs at all is refused, never handed over on liveness alone', () => {
  const root = mkTmpDir('sfvc-bl1201-incident-');
  writeAwaiting(root, 'specifier', { question: 'detached master checkout - what now?', asked_at_ms: 1756296000000 });
  writeAnswer(root, 'specifier', {
    text: 'Archive in-repo, still readable - move under the handoffs root; nothing deleted',
    recordedAt: '2026-08-22T17:01:36Z',
  });

  const result = deliverRoleAnswer(root, 'specifier');

  assert.equal(result.kind, 'mismatch');
  assert.equal(awaitingExists(root, 'specifier'), true);
});

// ── scenario 02: an already-consumed answer is never offered as fresh ─────

test('BL-1201: an already-consumed answer is reported as already-consumed, not delivered again', () => {
  const root = mkTmpDir('sfvc-bl1201-');
  writeAnswer(root, 'specifier', {
    text: 'use staging',
    recordedAt: '2026-08-20T10:00:00Z',
    askedAtMs: 500,
    consumedAt: '2026-08-20T10:05:00Z',
  });

  const result = deliverRoleAnswer(root, 'specifier');

  assert.equal(result.kind, 'already-consumed');
});

// ── scenario 03: a matching answer is delivered, question clears ──────────

test('BL-1201: an answer whose askedAtMs matches the pending question is delivered, and the question is no longer pending', () => {
  const root = mkTmpDir('sfvc-bl1201-');
  writeAwaiting(root, 'specifier', { question: 'which archive strategy?', asked_at_ms: 4242 });
  writeAnswer(root, 'specifier', { text: 'archive under handoffs root', recordedAt: '2026-08-27T18:00:00Z', askedAtMs: 4242 });

  const result = deliverRoleAnswer(root, 'specifier');

  assert.equal(result.kind, 'delivered');
  assert.equal(result.text, 'archive under handoffs root');
  assert.equal(awaitingExists(root, 'specifier'), false, 'a confirmed match must clear the pending question');
  const stored = readAnswer(root, 'specifier');
  assert.notEqual(stored.consumedAt, undefined, 'a delivered answer must be marked consumed');
  assert.equal(stored.text, 'archive under handoffs root', 'the text survives consumption unchanged');
});

// A second delivery attempt after a confirmed match must read as
// already-consumed, not delivered a second time.
test('BL-1201: delivering the same answer twice reports delivered once, then already-consumed', () => {
  const root = mkTmpDir('sfvc-bl1201-');
  writeAwaiting(root, 'specifier', { question: 'q', asked_at_ms: 99 });
  writeAnswer(root, 'specifier', { text: 'a', recordedAt: '2026-08-27T18:00:00Z', askedAtMs: 99 });

  const first = deliverRoleAnswer(root, 'specifier');
  const second = deliverRoleAnswer(root, 'specifier');

  assert.equal(first.kind, 'delivered');
  assert.equal(second.kind, 'already-consumed');
});

// ── no-answer: nothing recorded at all ─────────────────────────────────────

test('BL-1201: no recorded answer at all reports no-answer, never throws', () => {
  const root = mkTmpDir('sfvc-bl1201-');
  const result = deliverRoleAnswer(root, 'specifier');
  assert.equal(result.kind, 'no-answer');
});

// ── recording side: enqueueRoleAnswerNote stamps the correlator ───────────

test('BL-1201: enqueueRoleAnswerNote stamps the currently-pending question\'s askedAtMs onto the recorded answer', async () => {
  const root = mkTmpDir('sfvc-bl1201-');
  writeAwaiting(root, 'specifier', { question: 'q', asked_at_ms: 777 });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), 'specifier\tsession\t' + root + '\tswarmforge-specifier\tspecifier\tclaude\ttask\n');
  await enqueueRoleAnswerNote(root, 'specifier', 'use staging please');
  const stored = readAnswer(root, 'specifier');
  assert.equal(stored.text, 'use staging please');
  assert.equal(stored.askedAtMs, 777);
  // With the correlator now matching the still-pending question, delivery
  // succeeds end to end.
  const result = deliverRoleAnswer(root, 'specifier');
  assert.equal(result.kind, 'delivered');
});

test('BL-1201: enqueueRoleAnswerNote records no askedAtMs when nothing is pending, so delivery later refuses fail-closed', async () => {
  const root = mkTmpDir('sfvc-bl1201-');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), 'specifier\tsession\t' + root + '\tswarmforge-specifier\tspecifier\tclaude\ttask\n');
  await enqueueRoleAnswerNote(root, 'specifier', 'use staging please');
  const stored = readAnswer(root, 'specifier');
  assert.equal(stored.askedAtMs, undefined);
  // A question shows up LATER - the answer, captured with nothing
  // pending, must still never match it (fail-closed on undefined).
  writeAwaiting(root, 'specifier', { question: 'unrelated later question', asked_at_ms: 999 });
  const result = deliverRoleAnswer(root, 'specifier');
  assert.equal(result.kind, 'mismatch');
});
