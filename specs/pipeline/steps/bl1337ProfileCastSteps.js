'use strict';

// BL-1337: step handlers for "a named profile generates a cast, and no seat is
// runnable unhandshaken".
//
// Every scenario runs the REAL bob_starting_cast_cli.bb against a throwaway
// steward store - the same CLI a human runs - so "the cast is generated from
// that profile" means the shipped generator, the shipped handshake and the
// shipped apply gate all ran. The registry is seeded exactly as the ticket's
// qa_e2e_procedure describes: one seat whose top pick handshakes, one whose
// top pick is registry-ineligible, one whose top pick is unreachable here, and
// one with nothing above the floor.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  LIVE_PACK_TEXT,
  makeFixture,
  removeFixture,
  runCli,
  filesWritten,
} = require('./lib/bl1337ProfileCastFixture');

const FEATURE = 'BL-1337 a named profile generates a cast, and no seat is runnable unhandshaken';

// Scenario Outline cells, validated explicitly rather than passed through.
const KNOWN_CONDITIONS = {
  'is eligible and reachable': { role: 'coder', expect: 'claude-opus-5' },
  'is not assignment-eligible for that role': { role: 'cleaner', expect: 'qwen3.8-max' },
  'is eligible but unreachable on this host': { role: 'architect', expect: 'claude-opus-5' },
};
const KNOWN_OUTCOMES = new Set(['that model', 'the next model that handshakes']);
// What the no-secrets sweep looks for. Credential SHAPES, not one variable
// name: a note that printed a key would carry one of these.
const CREDENTIAL_MARKERS = ['API_KEY=', 'sk-', 'Bearer ', 'token=', 'fixture-not-a-real-key'];

function state(ctx) {
  if (!ctx.bl1337) ctx.bl1337 = { shape: {} };
  return ctx.bl1337;
}

function generate(ctx) {
  const st = state(ctx);
  if (st.run) return st;
  st.fx = makeFixture(st.shape);
  st.startedMs = Date.now();
  st.run = runCli(st.fx, ['export', '--profile', 'fixture']);
  const lastLine = st.run.stdout.trim().split('\n').filter(Boolean).pop();
  st.result = lastLine && lastLine.startsWith('{') ? JSON.parse(lastLine) : null;
  return st;
}

function teardown(ctx) {
  removeFixture(state(ctx).fx);
  ctx.bl1337 = { shape: {} };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a steward registry with role rankings and certification status$/, (ctx) => {
    state(ctx).seeded = true;
  });

  scoped(/^a named profile stating its topology, quality floor and provider rules$/, (ctx) => {
    const st = state(ctx);
    st.shape = { ...st.shape, roles: ['coder', 'cleaner', 'architect'], qualityFloor: 0.5 };
  });

  // ── Givens ───────────────────────────────────────────────────────────
  scoped(/^every seat the profile asks for has an eligible model reachable on this host$/, (ctx) => {
    // The three-seat profile above: each seat reaches a model that handshakes,
    // two of them only after their own top pick is rejected.
    state(ctx).expectRunnable = true;
  });

  scoped(/^a seat whose best-ranked model (.+)$/, (ctx, condition) => {
    const known = KNOWN_CONDITIONS[condition];
    assert.ok(known, `unknown condition cell: ${condition}`);
    const st = state(ctx);
    st.subjectRole = known.role;
    st.expectedModel = known.expect;
    st.shape = { ...st.shape, roles: [known.role] };
  });

  scoped(/^a seat for which no eligible model reaches the profile's quality floor$/, (ctx) => {
    const st = state(ctx);
    // QA's only ranked model scores 0.40, under the profile's 0.5 floor.
    st.shape = { ...st.shape, roles: ['coder', 'QA'], qualityFloor: 0.5 };
    st.subjectRole = 'QA';
  });

  scoped(/^a live pack is configured$/, (ctx) => {
    const st = state(ctx);
    st.checkLivePack = true;
  });

  // ── When ─────────────────────────────────────────────────────────────
  scoped(/^the cast is generated from that profile$/, (ctx) => {
    generate(ctx);
  });

  // ── Thens ────────────────────────────────────────────────────────────
  scoped(/^the cast is offered as runnable$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.run.status, 0, `generation failed: ${st.run.note.slice(-500)}`);
    assert.equal(st.result['runnable?'], true, `the cast was not offered as runnable: ${st.run.note.slice(-400)}`);
    assert.deepEqual(st.result.unstaffable, [], 'a seat was left unstaffed on a runnable cast');
  });

  scoped(/^an evidence note records the profile and each seat's handshake result$/, (ctx) => {
    const st = state(ctx);
    assert.match(st.run.note, /profile: fixture/, `the note does not name the profile: ${st.run.note}`);
    assert.match(st.run.note, /handshake bar: registry-and-host/, 'the note does not record the bar that was applied');
    for (const role of ['coder', 'cleaner', 'architect']) {
      assert.ok(new RegExp(`\\s${role}: `).test(st.run.note), `the note omits ${role}'s handshake result: ${st.run.note}`);
    }
    // ...including WHY a rejected candidate lost, which is what a human had to
    // work out by hand before this ticket.
    assert.match(st.run.note, /-> not-assignment-eligible/, 'the note does not say a candidate failed the registry bar');
    assert.match(st.run.note, /-> unreachable/, 'the note does not say a candidate failed the host bar');
    teardown(ctx);
  });

  scoped(/^that seat is staffed by (.+)$/, (ctx, outcome) => {
    assert.ok(KNOWN_OUTCOMES.has(outcome), `unknown outcome cell: ${outcome}`);
    const st = state(ctx);
    assert.equal(st.run.status, 0, `generation failed: ${st.run.note.slice(-400)}`);
    const entry = st.result.cast.roles[st.subjectRole];
    assert.ok(entry, `the seat was not staffed at all: ${JSON.stringify(st.result.unstaffable)}`);
    assert.equal(entry.model, st.expectedModel, `${st.subjectRole} was staffed by the wrong model`);

    const trail = st.result.handshakes[st.subjectRole];
    if (outcome === 'that model') {
      assert.equal(trail.length, 1, `expected the top pick to be taken first time: ${JSON.stringify(trail)}`);
      assert.equal(trail[0].verdict, 'accepted');
    } else {
      // The fall-through is the point: the best-ranked candidate was seen,
      // rejected with a reason, and a later one taken.
      assert.ok(trail.length > 1, `expected a rejected candidate before the staffed one: ${JSON.stringify(trail)}`);
      assert.notEqual(trail[0].verdict, 'accepted', 'the best-ranked model was not rejected');
      assert.equal(trail[trail.length - 1].verdict, 'accepted');
    }
    teardown(ctx);
  });

  scoped(/^the cast is not offered as runnable$/, (ctx) => {
    const st = state(ctx);
    assert.notEqual(st.run.status, 0, 'an unstaffable profile exited as if it had succeeded');
    assert.ok(!st.result || st.result['runnable?'] === false, 'the cast was still offered as runnable');
  });

  scoped(/^the failure names that seat$/, (ctx) => {
    const st = state(ctx);
    assert.ok(st.run.note.includes(st.subjectRole), `the failure does not name ${st.subjectRole}: ${st.run.note}`);
    assert.match(st.run.note, /cannot staff/, 'the failure is not loud about what it could not do');
    // ...and it does not quietly emit the seat anyway.
    assert.ok(!st.result || !st.result.cast.roles[st.subjectRole], 'a seat nothing could staff still reached the cast');
    teardown(ctx);
  });

  scoped(/^the live pack configuration is unchanged$/, (ctx) => {
    const st = state(ctx);
    assert.equal(fs.readFileSync(st.fx.livePack, 'utf8'), LIVE_PACK_TEXT, 'generating a cast changed the live pack');
    teardown(ctx);
  });

  scoped(/^no file it wrote contains credential material$/, (ctx) => {
    const st = state(ctx);
    // `export` only prints; the path that WRITES is `apply` (the ModelFactory
    // overlay). Sweeping only the export would be a sweep over nothing, so the
    // scenario drives the writing path too and covers both.
    const applied = runCli(st.fx, ['apply', '--profile', 'fixture']);
    assert.equal(applied.status, 0, `apply failed: ${applied.note.slice(-400)}`);
    st.applied = applied;
    const written = filesWritten(st.fx, st.startedMs);
    assert.ok(written.length > 0, 'the run wrote nothing - this sweep would be vacuous');
    for (const file of written) {
      const text = fs.readFileSync(file, 'utf8');
      for (const marker of CREDENTIAL_MARKERS) {
        assert.ok(!text.includes(marker), `${file} carries credential material (${marker})`);
      }
    }
    // The evidence note travels with the cast, so it is swept too.
    for (const marker of CREDENTIAL_MARKERS) {
      for (const [label, text] of [
        ['the evidence note', st.run.note],
        ['the generated cast', st.run.stdout],
        ["apply's own note", st.applied.note],
        ["apply's output", st.applied.stdout],
      ]) {
        assert.ok(!text.includes(marker), `${label} carries credential material (${marker})`);
      }
    }
    teardown(ctx);
  });
}

module.exports = { registerSteps };
