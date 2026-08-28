'use strict';

// BL-1201: step handlers for "a role never consumes a human answer it
// cannot match to its own pending question". Drives the REAL
// deliverRoleAnswer/roleAnswerFilePointerPath/roleAwaitingFilePointerPath
// (extension/out/tools/telegram-front-desk-bot) against real fixture
// files - the same on-disk shapes role_ask.bb and the front-desk bot
// itself read and write.

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
        roleAnswerFilePointerPath: mod.roleAnswerFilePointerPath,
        roleAwaitingFilePointerPath: mod.roleAwaitingFilePointerPath,
        role: 'specifier',
      };
    }
    return ctx.bl1201;
  }

  function writeAwaiting(st, record) {
    const abs = path.join(st.root, st.roleAwaitingFilePointerPath(st.role));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(record));
  }

  function writeAnswer(st, record) {
    const abs = path.join(st.root, st.roleAnswerFilePointerPath(st.role));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(record));
  }

  function awaitingExists(st) {
    return fs.existsSync(path.join(st.root, st.roleAwaitingFilePointerPath(st.role)));
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

  scoped(/^a recorded answer identifies that same pending question$/, (ctx) => {
    const st = ensureFixture(ctx);
    writeAnswer(st, { text: 'archive under handoffs root', recordedAt: '2026-08-27T18:00:00Z', askedAtMs: st.askedAtMs });
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
