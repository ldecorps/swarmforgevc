'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runNightClosingCeremony, mainHasBriefing } = require('../out/tools/night-closing-ceremony-run');
const { mkTmpDir } = require('./helpers/tmpDir');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

function makeDeps(over = {}) {
  const state = { current: null };
  const actions = [];
  return {
    deps: {
      readConf: () => 'config closure_stop_local 06:00\n',
      evaluate: () => ({
        mode: 'ceremony',
        scheduleState: 'ok',
        surfaced: 'nothing',
        consultFixedMorningTrigger: false,
        ceremonyDue: true,
        ceremonyBeginLocal: '05:25',
        closureStopLocal: '06:00',
      }),
      readState: () => state.current,
      writeState: (_t, s) => {
        state.current = s;
      },
      scanInFlight: () => ({ count: 0, roles: [] }),
      scanHeld: () => [],
      readActiveRole: () => 'coder',
      briefingSent: () => false,
      applyFreeze: (_t, untilMs) => actions.push(['freeze', untilMs]),
      rotateDocumenter: () => actions.push(['rotate']),
      instructBriefing: (_t, day) => actions.push(['instruct', day]),
      nightStop: () => actions.push(['stop']),
      surface: (_t, code) => actions.push(['surface', code]),
      recordCnp: (_t, held) => actions.push(['cnp', held]),
      // BL-1393: the lean pass is a step of this sequence now.
      // BL-1528: real deps return the loud codes a refused send produced.
      deliverLeanPacket: (_t, shiftKey) => {
        actions.push(['lean', shiftKey]);
        return [];
      },
      recordEmptyOutcome: (_t, shiftKey) => {
        actions.push(['empty', shiftKey]);
        return [];
      },
      workedAShift: () => true,
      // BL-1641: real deps land the documenter's own commit or compose the
      // banked headless briefing at the deadline; defaults here mean
      // "neither producible", so existing tests that never override these
      // (and never reach the deadline) are unaffected.
      landDocumenterBriefing: () => null,
      composeHeadlessBriefing: () => false,
      ...over,
    },
    state,
    actions,
  };
}

test('live run freezes and instructs when due with empty in_process', () => {
  const { deps, actions, state } = makeDeps();
  // now local 05:30-ish is not needed — evaluate stub forces ceremonyDue.
  const result = runNightClosingCeremony('/tmp/bl658-fixture', '/tmp/conf', Date.now(), deps);
  assert.equal(result.gateMode, 'ceremony');
  assert.ok(actions.some((a) => a[0] === 'freeze'));
  // first tick freezes; second advances drain→briefing
  const result2 = runNightClosingCeremony('/tmp/bl658-fixture', '/tmp/conf', Date.now() + 1000, deps);
  assert.ok(actions.some((a) => a[0] === 'rotate'));
  assert.ok(actions.some((a) => a[0] === 'instruct'));
  assert.equal(state.current.phase, 'briefing');
  assert.ok(result2.state.sequence.includes('freeze-promotion'));
});

test('live run night-stops once briefing is marked sent', () => {
  const { deps, actions, state } = makeDeps();
  runNightClosingCeremony('/tmp/x', '/tmp/c', 1_000_000, deps);
  runNightClosingCeremony('/tmp/x', '/tmp/c', 1_001_000, deps);
  deps.briefingSent = () => true;
  runNightClosingCeremony('/tmp/x', '/tmp/c', 1_002_000, deps);
  assert.ok(actions.some((a) => a[0] === 'stop'));
  assert.equal(state.current.phase, 'done');
  assert.ok(state.current.sequence.includes('send-confirmed'));
  // BL-1528: a clean run (deliverLeanPacket/recordEmptyOutcome report no
  // loud codes) must never pick up a stray loudSurfaces entry from a
  // non-lean-packet action (freeze/rotate/instruct/night-stop) along the way.
  assert.deepEqual(state.current.loudSurfaces, []);
});

// ── BL-1393 ──────────────────────────────────────────────────────────────

test('BL-1393: the ceremony delivers the lean packet before it instructs the briefing', () => {
  const { deps, actions } = makeDeps();
  runNightClosingCeremony('/tmp/bl1393', '/tmp/conf', Date.now(), deps);
  runNightClosingCeremony('/tmp/bl1393', '/tmp/conf', Date.now() + 1000, deps);

  const kinds = actions.map((a) => a[0]);
  assert.ok(kinds.includes('lean'), `no lean packet delivered: ${kinds.join(', ')}`);
  assert.ok(
    kinds.indexOf('lean') < kinds.indexOf('instruct'),
    `the packet must precede the briefing: ${kinds.join(', ')}`,
  );
});

test('BL-1393: a sleep path runs the ceremony even when the gate window is off', () => {
  // A weekday 17:00 bedtime: the gate says "off", the caller says "this is a
  // sleep". Before this ticket that combination ran the lean pass alone and
  // the full ceremony never happened on a weekday at all.
  const { deps, actions } = makeDeps({
    evaluate: () => ({ mode: 'off', scheduleState: 'ok', surfaced: 'nothing', ceremonyDue: false }),
  });

  const gated = runNightClosingCeremony('/tmp/bl1393', '/tmp/conf', Date.now(), deps);
  assert.equal(gated.advanced, false, 'with no sleep path the window still gates the daemon');
  assert.deepEqual(actions, []);

  const slept = runNightClosingCeremony('/tmp/bl1393', '/tmp/conf', Date.now(), deps, false, 'finish-shift');
  assert.equal(slept.gateMode, 'sleep:finish-shift');
  assert.ok(actions.some((a) => a[0] === 'freeze'), 'the sleep path freezes promotion');
});

test('BL-1393: a sleep after no shift of work records an empty outcome and sends no briefing', () => {
  const { deps, actions } = makeDeps({ workedAShift: () => false });
  runNightClosingCeremony('/tmp/bl1393', '/tmp/conf', Date.now(), deps, false, 'finish-shift');

  const kinds = actions.map((a) => a[0]);
  assert.ok(kinds.includes('empty'), `no empty outcome recorded: ${kinds.join(', ')}`);
  assert.ok(kinds.includes('stop'), 'the swarm still goes to sleep');
  assert.ok(!kinds.includes('instruct'), 'no briefing is instructed');
  assert.ok(!kinds.includes('lean'), 'no packet is delivered');
});

// ── BL-1528: a lean-packet send's own outcome is surfaced and folded into state ──

test('BL-1528: a loud code from deliverLeanPacket is surfaced through deps.surface and joins loudSurfaces', () => {
  const { deps, actions, state } = makeDeps({
    deliverLeanPacket: (_t, shiftKey) => {
      actions.push(['lean', shiftKey]);
      return ['closing-lean-packet-undeliverable 2026-09-13'];
    },
  });
  runNightClosingCeremony('/tmp/bl1528', '/tmp/conf', Date.now(), deps);
  const result = runNightClosingCeremony('/tmp/bl1528', '/tmp/conf', Date.now() + 1000, deps);

  assert.ok(
    actions.some((a) => a[0] === 'surface' && a[1] === 'closing-lean-packet-undeliverable 2026-09-13'),
    `expected the code to be surfaced through deps.surface: ${JSON.stringify(actions)}`
  );
  assert.ok(
    result.state.loudSurfaces.includes('closing-lean-packet-undeliverable 2026-09-13'),
    `expected the written state's loudSurfaces to include the code: ${JSON.stringify(result.state.loudSurfaces)}`
  );
  assert.ok(
    state.current.loudSurfaces.includes('closing-lean-packet-undeliverable 2026-09-13'),
    'expected the persisted state (deps.writeState) to also carry it'
  );
});

test('BL-1528: a lean-packet send with no loud codes leaves loudSurfaces untouched', () => {
  const { deps, actions } = makeDeps();
  runNightClosingCeremony('/tmp/bl1528b', '/tmp/conf', Date.now(), deps);
  const result = runNightClosingCeremony('/tmp/bl1528b', '/tmp/conf', Date.now() + 1000, deps);

  assert.ok(!actions.some((a) => a[0] === 'surface'), 'expected no surface call when deliverLeanPacket reports nothing');
  assert.deepEqual(result.state.loudSurfaces, []);
});

// ── BL-1640: a sleep's deadlines are relative to the sleep itself ────────

test('BL-1640: a sleep anchors drainDeadlineMs/hardDeadlineMs to now plus the conf budgets', () => {
  const { deps } = makeDeps({
    evaluate: () => ({
      mode: 'ceremony',
      scheduleState: 'ok',
      surfaced: 'nothing',
      consultFixedMorningTrigger: false,
      ceremonyDue: false,
      ceremonyBeginLocal: '05:25',
      closureStopLocal: '08:45',
      drainBudgetMinutes: 2,
      briefingBudgetMinutes: 1,
    }),
  });
  const nowMs = Date.UTC(2026, 8, 21, 16, 0, 0);
  const result = runNightClosingCeremony('/tmp/bl1640', '/tmp/conf', nowMs, deps, false, 'finish-shift');
  assert.equal(result.state.drainDeadlineMs, nowMs + 2 * 60_000);
  assert.equal(result.state.hardDeadlineMs, nowMs + 3 * 60_000);
});

test('BL-1640: the daemon path keeps its own hardcoded drain budget, ignoring the conf budgets exposed for sleeps', () => {
  const { deps } = makeDeps({
    evaluate: () => ({
      mode: 'ceremony',
      scheduleState: 'ok',
      surfaced: 'nothing',
      consultFixedMorningTrigger: false,
      ceremonyDue: true,
      ceremonyBeginLocal: '05:25',
      closureStopLocal: '08:45',
      drainBudgetMinutes: 2,
      briefingBudgetMinutes: 1,
    }),
  });
  const nowMs = Date.now();
  const result = runNightClosingCeremony('/tmp/bl1640b', '/tmp/conf', nowMs, deps);
  assert.equal(result.state.drainDeadlineMs, nowMs + 25 * 60_000);
});

test('BL-1640: a second sleep after a worked shift the same day starts a new ceremony over a done state', () => {
  // Day 1: no shift of work - one tick, a quiet 'done' with no briefing sent
  // (isolates the restart mechanism from the unrelated "already briefed
  // today" short-circuit, which itself also correctly reopens as 'done').
  const { deps, state } = makeDeps({ workedAShift: () => false });
  const nowMs = Date.now();
  const first = runNightClosingCeremony('/tmp/bl1640c', '/tmp/conf', nowMs, deps, false, 'finish-shift');
  assert.equal(first.state.phase, 'done');

  // Day 1 (same nightKey), a shift now happened: a second sleep must reopen.
  deps.workedAShift = () => true;
  const second = runNightClosingCeremony('/tmp/bl1640c', '/tmp/conf', nowMs + 5000, deps, false, 'finish-shift');
  assert.equal(second.state.phase, 'frozen', 'a second sleep with a worked shift reopens the ceremony');
  assert.deepEqual(second.state.sequence, ['freeze-promotion']);
  assert.equal(second.state.startedAtMs, nowMs + 5000);
  assert.equal(state.current.phase, 'frozen');
});

test('BL-1640: a second sleep with no shift since stays quiet over a done state', () => {
  const { deps, state } = makeDeps();
  const nowMs = Date.now();
  deps.briefingSent = () => true;
  runNightClosingCeremony('/tmp/bl1640d', '/tmp/conf', nowMs, deps, false, 'finish-shift');
  assert.equal(state.current.phase, 'done');

  deps.workedAShift = () => false;
  const second = runNightClosingCeremony('/tmp/bl1640d', '/tmp/conf', nowMs + 5000, deps, false, 'finish-shift');
  assert.equal(second.state.phase, 'done');
  assert.equal(second.advanced, false);
});

test('BL-1640: the daemon sweep never reopens a done night, even after a worked shift', () => {
  const { deps, state } = makeDeps();
  const nowMs = Date.now();
  deps.briefingSent = () => true;
  runNightClosingCeremony('/tmp/bl1640e', '/tmp/conf', nowMs, deps, false, 'finish-shift');
  assert.equal(state.current.phase, 'done');

  // No sleepPath now: this is the daemon's own sweep.
  const second = runNightClosingCeremony('/tmp/bl1640e', '/tmp/conf', nowMs + 5000, deps);
  assert.equal(second.state.phase, 'done', 'the daemon must never reopen a night it already closed');
  assert.equal(second.advanced, false);
});

// ── BL-1641: at the deadline, ensure-briefing lands or composes ──────────

test('BL-1641: at the hard deadline, ensure-briefing lands the documenter commit and folds the step before swarm-stopped', () => {
  const { deps, actions } = makeDeps({
    landDocumenterBriefing: (_t, dayKey) => {
      actions.push(['land', dayKey]);
      return 'abcabcabcabc';
    },
    composeHeadlessBriefing: () => {
      throw new Error('must not run when landing succeeded');
    },
  });
  const t0 = Date.now();
  runNightClosingCeremony('/tmp/bl1641a', '/tmp/conf', t0, deps, false, 'finish-shift');
  runNightClosingCeremony('/tmp/bl1641a', '/tmp/conf', t0 + 1000, deps, false, 'finish-shift');
  const result = runNightClosingCeremony('/tmp/bl1641a', '/tmp/conf', t0 + 40 * 60_000, deps, false, 'finish-shift');
  assert.ok(actions.some((a) => a[0] === 'land'), `landDocumenterBriefing was not called: ${JSON.stringify(actions)}`);
  assert.ok(
    result.state.sequence.includes('briefing-landed-from-documenter'),
    `sequence missing forced step: ${result.state.sequence.join(' -> ')}`,
  );
  const idx = result.state.sequence.indexOf('briefing-landed-from-documenter');
  assert.ok(idx < result.state.sequence.indexOf('swarm-stopped'), 'the forced step must precede swarm-stopped');
});

test('BL-1641: when landing fails, ensure-briefing falls back to composing the headless briefing', () => {
  const { deps, actions } = makeDeps({
    landDocumenterBriefing: () => {
      actions.push(['land', null]);
      return null;
    },
    composeHeadlessBriefing: (_t, dayKey) => {
      actions.push(['compose', dayKey]);
      return true;
    },
  });
  const t0 = Date.now();
  runNightClosingCeremony('/tmp/bl1641b', '/tmp/conf', t0, deps, false, 'finish-shift');
  runNightClosingCeremony('/tmp/bl1641b', '/tmp/conf', t0 + 1000, deps, false, 'finish-shift');
  const result = runNightClosingCeremony('/tmp/bl1641b', '/tmp/conf', t0 + 40 * 60_000, deps, false, 'finish-shift');
  assert.ok(actions.some((a) => a[0] === 'land'));
  assert.ok(actions.some((a) => a[0] === 'compose'));
  assert.ok(result.state.sequence.includes('briefing-composed-headless'));
});

test('BL-1641: when neither lands nor composes, the sequence still ends briefing-missing, swarm-stopped with no forced step', () => {
  const { deps } = makeDeps({
    landDocumenterBriefing: () => null,
    composeHeadlessBriefing: () => false,
  });
  const t0 = Date.now();
  runNightClosingCeremony('/tmp/bl1641c', '/tmp/conf', t0, deps, false, 'finish-shift');
  runNightClosingCeremony('/tmp/bl1641c', '/tmp/conf', t0 + 1000, deps, false, 'finish-shift');
  const result = runNightClosingCeremony('/tmp/bl1641c', '/tmp/conf', t0 + 40 * 60_000, deps, false, 'finish-shift');
  assert.deepEqual(result.state.sequence.slice(-2), ['briefing-missing', 'swarm-stopped']);
  assert.ok(!result.state.sequence.includes('briefing-landed-from-documenter'));
  assert.ok(!result.state.sequence.includes('briefing-composed-headless'));
});

test('BL-1528: a loud code from recordEmptyOutcome is surfaced the same way', () => {
  const { deps, actions } = makeDeps({
    workedAShift: () => false,
    recordEmptyOutcome: (_t, shiftKey) => {
      actions.push(['empty', shiftKey]);
      return ['closing-lean-packet-undeliverable 2026-09-13'];
    },
  });
  const result = runNightClosingCeremony('/tmp/bl1528c', '/tmp/conf', Date.now(), deps, false, 'finish-shift');

  assert.ok(
    actions.some((a) => a[0] === 'surface' && a[1] === 'closing-lean-packet-undeliverable 2026-09-13'),
    `expected the code to be surfaced: ${JSON.stringify(actions)}`
  );
  assert.ok(result.state.loudSurfaces.includes('closing-lean-packet-undeliverable 2026-09-13'));
});

// ── BL-1641 architect bounce D1: mainHasBriefing fails CLOSED on a git
//    read error that is NOT "the path is genuinely absent from main" -
//    e.g. `main` itself does not resolve (no such ref). Before the fix,
//    every git-level failure (including this one) was swallowed into
//    "absent" (return false), which is exactly "safe to write" - the
//    opposite of the function's own documented contract. Drives the REAL
//    exported mainHasBriefing directly against a real git fixture, so the
//    guard's own true/false decision is observed directly rather than
//    inferred through a multi-step write pipeline that degrades quietly
//    for unrelated reasons (no documenter branch, no commit_integrity_cli.bb)
//    regardless of this guard's answer.
//
// BL-1039: the fixture comes from the shared seeded template
// (copySeededRepoInto), never a raw `git init` - the template's own
// default branch is "main" with one commit, so it already IS the
// genuine-absence/genuine-presence shape; the no-main-ref cases rename
// that branch away (an ordinary git operation on the copy, not a second
// repository creation).

function gitFixture() {
  const root = mkTmpDir('bl1641-mainhasbriefing-');
  copySeededRepoInto(root);
  return root;
}

test('BL-1641 invariant 1a: mainHasBriefing reads TRUE (fail closed) when the main ref itself does not resolve - a real git error, not path absence', () => {
  const root = gitFixture();
  // Rename "main" away so no such ref exists - git cat-file -e fails with
  // "invalid object name 'main'", never "path ... does not exist in 'main'".
  execFileSync('git', ['branch', '-m', 'main', 'trunk'], { cwd: root });
  let threwPathAbsent = false;
  try {
    execFileSync('git', ['cat-file', '-e', 'main:docs/briefings/2026-09-08.md'], { cwd: root, stdio: 'pipe' });
  } catch (err) {
    threwPathAbsent = /does not exist in/.test(String(err.stderr));
  }
  assert.equal(threwPathAbsent, false, 'fixture bug: expected an "invalid object name" error, not a path-absent one');

  assert.equal(mainHasBriefing(root, '2026-09-08'), true, 'expected fail-closed (true, "main might already have it") on a non-path-absent git error');
});

test('BL-1641 invariant 1a: mainHasBriefing reads TRUE (fail closed) against a directory that is not a git repository at all', () => {
  const root = mkTmpDir('bl1641-mainhasbriefing-norepo-');
  assert.equal(mainHasBriefing(root, '2026-09-08'), true, 'expected fail-closed (true) when "not a git repository" is the underlying error');
});

test('BL-1641 invariant 1a: mainHasBriefing reads FALSE only for the genuine "path does not exist in main" shape (the ref itself resolves fine)', () => {
  const root = gitFixture();
  let threwPathAbsent = false;
  try {
    execFileSync('git', ['cat-file', '-e', 'main:docs/briefings/2026-09-08.md'], { cwd: root, stdio: 'pipe' });
  } catch (err) {
    threwPathAbsent = /does not exist in/.test(String(err.stderr));
  }
  assert.equal(threwPathAbsent, true, 'fixture bug: expected the genuine path-absent error shape');

  assert.equal(mainHasBriefing(root, '2026-09-08'), false, 'expected false (absent) only for the genuine path-not-present-in-main shape');
});

test('BL-1641 invariant 1a: mainHasBriefing reads TRUE when the path genuinely exists on main', () => {
  const root = gitFixture();
  fs.mkdirSync(path.join(root, 'docs', 'briefings'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'briefings', '2026-09-08.md'), '# briefing\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'add briefing'], { cwd: root });

  assert.equal(mainHasBriefing(root, '2026-09-08'), true, 'expected true when the briefing genuinely exists on main');
});
