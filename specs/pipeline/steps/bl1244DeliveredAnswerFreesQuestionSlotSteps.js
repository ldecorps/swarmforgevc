'use strict';

// BL-1244: an answer delivered to a role must free that role's question
// slot, without weakening the pairing check that decides whether it
// should (BL-1201's guarantee). Drives the REAL
// extension/out/tools/telegram-front-desk-bot.js (roleAwaitingAnswerPath,
// roleAnswerFilePointerPath, readRoleAwaitingAnswer, deliverRoleAnswer)
// against a real fixture directory - never a reimplementation of the
// pairing/consume logic.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const {
  roleAwaitingAnswerPath,
  roleAnswerFilePointerPath,
  readRoleAwaitingAnswer,
  deliverRoleAnswer,
} = require(path.join(REPO_ROOT, 'extension', 'out', 'tools', 'telegram-front-desk-bot.js'));

const FEATURE_NAME = "An answer delivered to a role frees that role's question slot";

const FIXTURE_PREFIX = 'bl1244-slot-';

// BL-971: sweep stale fixture dirs by prefix BEFORE the run too.
function sweepStaleFixtures() {
  const tmp = os.tmpdir();
  for (const name of fs.readdirSync(tmp)) {
    if (name.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
    }
  }
}

function writeAwaiting(root, role, askedAtMs) {
  const abs = roleAwaitingAnswerPath(root, role);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({ question: 'which environment?', asked_at_ms: askedAtMs }));
}

function writeAnswer(root, role, text, askedAtMs) {
  const abs = path.join(root, roleAnswerFilePointerPath(role));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const record = { text, recordedAt: new Date().toISOString() };
  if (askedAtMs !== undefined) record.askedAtMs = askedAtMs;
  fs.writeFileSync(abs, JSON.stringify(record));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  scoped(/^role "([^"]+)" has a pending clarifying question$/, (ctx, role) => {
    sweepStaleFixtures();
    ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
    ctx.role = role;
    ctx.askedAtMs = 1000;
    writeAwaiting(ctx.root, role, ctx.askedAtMs);
  });

  scoped(/^the human answers "([^"]+)"$/, (ctx, text) => {
    ctx.answerText = text;
    // The exact moment enqueueRoleAnswerNote's own writeRoleAnswerFile
    // stamps the answer file - the currently-pending marker's own
    // askedAtMs, read at capture time.
    writeAnswer(ctx.root, ctx.role, text, ctx.askedAtMs);
  });

  scoped(/^an answer recorded against a different question is delivered to the role$/, (ctx) => {
    // A DIFFERENT askedAtMs than the currently-pending marker - the answer
    // was captured for some earlier (or other) question, not this one.
    writeAnswer(ctx.root, ctx.role, 'a stale answer', ctx.askedAtMs + 999);
    ctx.result = deliverRoleAnswer(ctx.root, ctx.role);
  });

  scoped(/^no answer has been recorded for the role$/, (ctx) => {
    // Nothing written - deliverRoleAnswer is never even attempted in
    // production for this case (nothing to confirm), but calling it here
    // exercises the SAME fail-closed 'no-answer' path defensively.
    ctx.result = deliverRoleAnswer(ctx.root, ctx.role);
  });

  scoped(/^the answer is delivered to the role$/, (ctx) => {
    ctx.result = deliverRoleAnswer(ctx.root, ctx.role);
  });

  scoped(/^role "([^"]+)" raising a new question is accepted$/, (ctx, role) => {
    try {
      const pending = readRoleAwaitingAnswer(ctx.root, role);
      if (pending !== undefined) {
        throw new Error(`expected the slot to be open (no pending marker), still found: ${JSON.stringify(pending)}`);
      }
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });

  scoped(/^role "([^"]+)" raising a new question is refused as already-pending$/, (ctx, role) => {
    try {
      const pending = readRoleAwaitingAnswer(ctx.root, role);
      if (pending === undefined) {
        throw new Error('expected the slot to still be shut (marker present), but it was cleared');
      }
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });

  scoped(/^the role receives the answer "([^"]+)"$/, (ctx, expectedText) => {
    try {
      if (!ctx.result || ctx.result.kind !== 'delivered') {
        throw new Error(`expected a delivered result, got: ${JSON.stringify(ctx.result)}`);
      }
      if (ctx.result.text !== expectedText) {
        throw new Error(`expected answer text "${expectedText}", got "${ctx.result.text}"`);
      }
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });
}

module.exports = { registerSteps };
