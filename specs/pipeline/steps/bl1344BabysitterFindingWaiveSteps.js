'use strict';

// BL-1344: step handlers for "an investigated babysitter finding can be
// waived, and stays waived".
//
// Every scenario drives the REAL babysitter_check.bb --nudge against a real
// git repo whose `main` carries Article 4.2 findings swarmforge-QA does not
// - the live case the ticket was filed for, where the finding key is a commit
// sha and therefore never clears. A waive is recorded only through the CLI a
// human runs (babysitter_waive.bb), never by the sweep.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  makeFixture,
  removeFixture,
  runSweep,
  recordWaive,
  listWaives,
  readStore,
  elapseCooldown,
} = require('./lib/bl1344WaiveFixture');

const FEATURE = 'BL-1344 an investigated babysitter finding can be waived, and stays waived';

// Scenario Outline cells are validated against these explicit values, never
// passed through (engineering.prompt, Acceptance Pipeline).
const KNOWN_STORE_STATES = new Set(['unreadable', 'malformed']);

const WAIVER = 'coordinator';
const REASON = 'investigated 2026-09-02: QA\'s own legitimate land';

function state(ctx) {
  if (!ctx.bl1344) ctx.bl1344 = {};
  return ctx.bl1344;
}

function fixture(ctx) {
  const st = state(ctx);
  if (!st.fx) {
    st.fx = makeFixture();
    // "That finding" throughout is the FIRST of the two the fixture lands on
    // main; the second exists so a waive can be shown to silence one key and
    // not its own class.
    st.subject = st.fx.keys.first;
    st.subjectSha = st.fx.shas.first;
    st.otherKey = st.fx.keys.second;
    st.otherSha = st.fx.shas.second;
  }
  return st.fx;
}

function teardown(ctx) {
  const st = state(ctx);
  removeFixture(st.fx);
  st.fx = null;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^the babysitter sweep produces a finding with a stable finding key$/, (ctx) => {
    const fx = fixture(ctx);
    // Stable by construction: the key is derived from a commit sha, so it is
    // the same on every sweep for as long as the commit exists - which is
    // exactly why a rolling cooldown can never end it.
    assert.match(state(ctx).subject, /^pipeline-code-on-main-[0-9a-f]{40}$/);
    assert.equal(readStore(fx), null, 'the fixture starts with no waive store at all');
  });

  // ── Givens ───────────────────────────────────────────────────────────
  scoped(/^a recorded waive for that finding key$/, (ctx) => {
    const st = state(ctx);
    recordWaive(fixture(ctx), st.subject, WAIVER, REASON);
  });

  scoped(/^a recorded waive for a different finding key$/, (ctx) => {
    const st = state(ctx);
    recordWaive(fixture(ctx), st.otherKey, WAIVER, 'a different finding, already remediated');
  });

  scoped(/^no recorded waive for that finding key$/, (ctx) => {
    const fx = fixture(ctx);
    assert.equal(readStore(fx), null, 'this scenario requires no waive store');
    state(ctx).storeBefore = readStore(fx);
  });

  scoped(/^the nudge cooldown for it has elapsed$/, (ctx) => {
    const fx = fixture(ctx);
    // An earlier sweep already nudged and stamped the dedup file; backdate
    // that stamp rather than touching the cooldown, which this ticket
    // deliberately leaves alone.
    runSweep(fx);
    elapseCooldown(fx);
  });

  scoped(/^the waive store is "(.+)"$/, (ctx, storeState) => {
    assert.ok(KNOWN_STORE_STATES.has(storeState), `unknown store state cell: ${storeState}`);
    const st = state(ctx);
    const fx = fixture(ctx);
    if (storeState === 'unreadable') {
      // A directory where the store should be: the read fails with an I/O
      // condition, with no permissions trick to simulate it (engineering.
      // prompt) and no root-user hole.
      fs.mkdirSync(fx.storePath, { recursive: true });
    } else {
      fs.mkdirSync(require('node:path').dirname(fx.storePath), { recursive: true });
      fs.writeFileSync(fx.storePath, '{{{ this is not a waive store\n');
    }
    st.storeState = storeState;
  });

  // ── Whens ────────────────────────────────────────────────────────────
  scoped(/^the sweep runs$/, (ctx) => {
    const st = state(ctx);
    st.storeBefore = readStore(st.fx);
    st.sweep = runSweep(fixture(ctx));
  });

  scoped(/^the waived findings are listed$/, (ctx) => {
    state(ctx).listing = listWaives(fixture(ctx));
  });

  // ── Thens ────────────────────────────────────────────────────────────
  scoped(/^no nudge is sent for that finding$/, (ctx) => {
    const st = state(ctx);
    assert.ok(
      !st.sweep.nudgeText.includes(st.subjectSha),
      `the waived finding was still nudged: ${st.sweep.nudgeText}`,
    );
    // Suppressed, not erased: the sweep still reports the finding and says
    // plainly why its nudge stopped.
    assert.match(st.sweep.out, new RegExp(`CRIT \\[${st.subject}\\]`), 'the waived finding stopped being reported at all');
    assert.match(st.sweep.out, new RegExp(`WAIVED \\[${st.subject}\\]`), 'the sweep did not say the nudge was waived');
    teardown(ctx);
  });

  scoped(/^a nudge is sent for that finding$/, (ctx) => {
    const st = state(ctx);
    assert.ok(st.sweep.nudgeText.includes(st.subjectSha), `no nudge carried the finding: ${st.sweep.nudgeText}`);
    if (st.storeState) {
      // An unusable store must say so rather than going quiet - the reader
      // has to be able to tell "nothing waived" from "could not tell".
      assert.match(
        st.sweep.out,
        /WAIVE-STORE-UNUSABLE (unreadable|unparseable|incomplete-entry)/,
        `an unusable waive store passed silently: ${st.sweep.out}`,
      );
      assert.doesNotMatch(st.sweep.out, /WAIVED \[/, 'an unusable store suppressed a finding anyway');
    }
    teardown(ctx);
  });

  scoped(/^no waive exists for that finding key afterwards$/, (ctx) => {
    const st = state(ctx);
    // The sweep may propose; only a recorded decision disposes. Measured as a
    // before/after diff of the store, not as an absence of a log line.
    assert.equal(readStore(st.fx), st.storeBefore, 'the sweep changed the waive store');
    assert.equal(readStore(st.fx), null, 'the sweep created a waive of its own');
    const listing = listWaives(st.fx);
    assert.match(listing.out, /no waived findings/, `the sweep waived something: ${listing.out}`);
    teardown(ctx);
  });

  scoped(/^the listing names that finding key, who waived it and the stated reason$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.listing.status, 0, `listing failed: ${st.listing.out}`);
    assert.ok(st.listing.out.includes(st.subject), `the listing omits the key: ${st.listing.out}`);
    assert.ok(st.listing.out.includes(WAIVER), `the listing omits who waived it: ${st.listing.out}`);
    assert.ok(st.listing.out.includes(REASON), `the listing omits the stated reason: ${st.listing.out}`);
    teardown(ctx);
  });
}

module.exports = { registerSteps };
