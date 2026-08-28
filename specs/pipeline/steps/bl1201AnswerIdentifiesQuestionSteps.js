'use strict';

// BL-1201: step handlers for "a role never consumes a human answer it
// cannot match to its own pending question". Drives the REAL
// deliverRoleAnswer/roleAnswerFilePointerPath/roleAwaitingAnswerPath/
// enqueueRoleAnswerNote (extension/out/tools/telegram-front-desk-bot)
// against real fixture files - the same on-disk shapes role_ask.bb and
// the front-desk bot itself read and write. Scenario 03 drives the REAL
// capture sequence (enqueueRoleAnswerNote then deliverRoleAnswer, no
// intervening clear) per the architect's own D1 finding - a hand-written
// answer fixture alone does not exercise that production wiring.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'a role never consumes a human answer it cannot match to its own pending question';

const MODULE = path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'telegram-front-desk-bot');

function mkFixtureRoot() {
  return fs.realpathSync(mkSocketFixtureRoot('bl1201-acceptance-'));
}

function cleanupFixtureRoot(ctx) {
  const st = ctx.bl1201;
  if (!st || !st.root) return;
  releaseSocketFixtureRoot(st.root);
  fs.rmSync(st.root, { recursive: true, force: true });
  ctx.bl1201 = null;
}

function loadModule() {
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  function ensureFixture(ctx) {
    if (!ctx.bl1201) {
      const mod = loadModule();
      ctx.bl1201 = {
        root: mkFixtureRoot(),
        deliverRoleAnswer: mod.deliverRoleAnswer,
        enqueueRoleAnswerNote: mod.enqueueRoleAnswerNote,
        roleAnswerFilePointerPath: mod.roleAnswerFilePointerPath,
        roleAwaitingAnswerPath: mod.roleAwaitingAnswerPath,
        role: 'specifier',
      };
    }
    return ctx.bl1201;
  }

  function writeAwaiting(st, record) {
    const abs = st.roleAwaitingAnswerPath(st.root, st.role);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(record));
  }

  function writeAnswer(st, record) {
    const abs = path.join(st.root, st.roleAnswerFilePointerPath(st.role));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(record));
  }

  function awaitingExists(st) {
    return fs.existsSync(st.roleAwaitingAnswerPath(st.root, st.role));
  }

  scoped(/^a role has a pending question recorded$/, (ctx) => {
    const st = ensureFixture(ctx);
    st.askedAtMs = 1756296000000;
    writeAwaiting(st, { question: 'detached master checkout - what now?', asked_at_ms: st.askedAtMs });
  });

  // ── scenario 01: mismatch ────────────────────────────────────────────────

  scoped(/^a recorded answer identifies a different question$/, (ctx) => {
    const st = ensureFixture(ctx);
    writeAnswer(st, {
      text: 'Archive in-repo, still readable - move under the handoffs root; nothing deleted',
      recordedAt: '2026-08-22T17:01:36Z',
      askedAtMs: (st.askedAtMs || 0) - 1,
    });
  });

  scoped(/^the role is told an answer is ready$/, (ctx) => {
    const st = ensureFixture(ctx);
    st.result = st.deliverRoleAnswer(st.root, st.role);
  });

  scoped(/^the answer is reported as not matching the pending question$/, (ctx) => {
    const st = ctx.bl1201;
    assert.equal(st.result.kind, 'mismatch', `expected a mismatch verdict, got: ${JSON.stringify(st.result)}`);
  });

  scoped(/^the pending question is still pending$/, (ctx) => {
    const st = ctx.bl1201;
    try {
      assert.equal(awaitingExists(st), true, 'expected the pending question to remain recorded after a mismatch');
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  // ── scenario 02: already consumed ────────────────────────────────────────

  scoped(/^a recorded answer has already been consumed by the role it was for$/, (ctx) => {
    const st = ensureFixture(ctx);
    writeAnswer(st, {
      text: 'use staging',
      recordedAt: '2026-08-20T10:00:00Z',
      askedAtMs: 500,
      consumedAt: '2026-08-20T10:05:00Z',
    });
  });

  scoped(/^the answer is reported as already consumed$/, (ctx) => {
    const st = ctx.bl1201;
    try {
      assert.equal(st.result.kind, 'already-consumed', `expected an already-consumed verdict, got: ${JSON.stringify(st.result)}`);
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  // ── scenario 03: matching answer is consumed normally ────────────────────
  // Drives the REAL production capture sequence - enqueueRoleAnswerNote
  // (which stamps askedAtMs from the awaiting marker written by the
  // Background above, and does NOT clear it) followed by deliverRoleAnswer
  // - rather than a hand-written answer fixture, per the architect's own
  // D1 finding that a hand-written fixture never exercises the real wiring.

  scoped(/^a recorded answer identifies that same pending question$/, async (ctx) => {
    const st = ensureFixture(ctx);
    fs.mkdirSync(path.join(st.root, '.swarmforge'), { recursive: true });
    fs.writeFileSync(
      path.join(st.root, '.swarmforge', 'roles.tsv'),
      `${st.role}\tsession\t${st.root}\tswarmforge-${st.role}\t${st.role}\tclaude\ttask\n`
    );
    await st.enqueueRoleAnswerNote(st.root, st.role, 'archive under handoffs root');
  });

  scoped(/^the answer is delivered to the role$/, (ctx) => {
    const st = ctx.bl1201;
    assert.equal(st.result.kind, 'delivered', `expected a delivered verdict, got: ${JSON.stringify(st.result)}`);
    assert.equal(st.result.text, 'archive under handoffs root');
  });

  scoped(/^the pending question is no longer pending$/, (ctx) => {
    const st = ctx.bl1201;
    try {
      assert.equal(awaitingExists(st), false, 'expected the pending question to be cleared after a confirmed match');
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });
}

module.exports = { registerSteps };
