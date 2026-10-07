'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  runNightClosingCeremony,
  mainHasBriefing,
  briefingSent,
  SENT_LEDGER_KEY,
} = require('../out/tools/night-closing-ceremony-run');
const { mkTmpDir } = require('./helpers/tmpDir');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

// BL-1764: a fixed local noon, never the wall clock - every tick this
// file makes (up to +40 min) stays inside the same local calendar day
// regardless of when the suite actually runs, whatever TZ it runs under.
const FIXED_NOW_MS = new Date(2026, 8, 25, 12, 0, 0).getTime();

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
      // BL-1836: real deps land the documenter's own briefing commit on any
      // briefing tick; the defaults mean "nothing to land, nothing on main".
      landDocumenterBriefing: () => null,
      mainHasBriefing: () => false,
      ...over,
    },
    state,
    actions,
  };
}

test('live run freezes and instructs when due with empty in_process', () => {
  const { deps, actions, state } = makeDeps();
  // now local 05:30-ish is not needed — evaluate stub forces ceremonyDue.
  const result = runNightClosingCeremony('/tmp/bl658-fixture', '/tmp/conf', FIXED_NOW_MS, deps);
  assert.equal(result.gateMode, 'ceremony');
  assert.ok(actions.some((a) => a[0] === 'freeze'));
  // first tick freezes; second advances drain→briefing
  const result2 = runNightClosingCeremony('/tmp/bl658-fixture', '/tmp/conf', FIXED_NOW_MS + 1000, deps);
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
  runNightClosingCeremony('/tmp/bl1393', '/tmp/conf', FIXED_NOW_MS, deps);
  runNightClosingCeremony('/tmp/bl1393', '/tmp/conf', FIXED_NOW_MS + 1000, deps);

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

  const gated = runNightClosingCeremony('/tmp/bl1393', '/tmp/conf', FIXED_NOW_MS, deps);
  assert.equal(gated.advanced, false, 'with no sleep path the window still gates the daemon');
  assert.deepEqual(actions, []);

  const slept = runNightClosingCeremony('/tmp/bl1393', '/tmp/conf', FIXED_NOW_MS, deps, false, 'finish-shift');
  assert.equal(slept.gateMode, 'sleep:finish-shift');
  assert.ok(actions.some((a) => a[0] === 'freeze'), 'the sleep path freezes promotion');
});

test('BL-1393: a sleep after no shift of work records an empty outcome and sends no briefing', () => {
  const { deps, actions } = makeDeps({ workedAShift: () => false });
  runNightClosingCeremony('/tmp/bl1393', '/tmp/conf', FIXED_NOW_MS, deps, false, 'finish-shift');

  const kinds = actions.map((a) => a[0]);
  assert.ok(kinds.includes('empty'), `no empty outcome recorded: ${kinds.join(', ')}`);
  assert.ok(kinds.includes('stop'), 'the swarm still goes to sleep');
  assert.ok(!kinds.includes('instruct'), 'no briefing is instructed');
  assert.ok(!kinds.includes('lean'), 'no packet is delivered');
});

// ── BL-1967: deliverLeanPacket/recordEmptyOutcome receive the real instant ──

test('BL-1967: record-empty-outcome hands deps the real nowMs, never a value derived from shiftKey', () => {
  const nowMs = FIXED_NOW_MS + 12345;
  let seenNowMs = null;
  const { deps } = makeDeps({
    workedAShift: () => false,
    recordEmptyOutcome: (_t, _shiftKey, passedNowMs) => {
      seenNowMs = passedNowMs;
      return [];
    },
  });
  runNightClosingCeremony('/tmp/bl1967-empty', '/tmp/conf', nowMs, deps, false, 'finish-shift');
  assert.equal(seenNowMs, nowMs);
});

test('BL-1967: lean-packet hands deps the real nowMs too, on the already-briefed shortcut path', () => {
  const nowMs = FIXED_NOW_MS + 54321;
  let seenNowMs = null;
  const { deps } = makeDeps({
    workedAShift: () => true,
    briefingSent: () => true,
    deliverLeanPacket: (_t, _shiftKey, passedNowMs) => {
      seenNowMs = passedNowMs;
      return [];
    },
  });
  runNightClosingCeremony('/tmp/bl1967-lean', '/tmp/conf', nowMs, deps, false, 'finish-shift');
  assert.equal(seenNowMs, nowMs);
});

// ── BL-1528: a lean-packet send's own outcome is surfaced and folded into state ──

test('BL-1528: a loud code from deliverLeanPacket is surfaced through deps.surface and joins loudSurfaces', () => {
  const { deps, actions, state } = makeDeps({
    deliverLeanPacket: (_t, shiftKey) => {
      actions.push(['lean', shiftKey]);
      return ['closing-lean-packet-undeliverable 2026-09-13'];
    },
  });
  runNightClosingCeremony('/tmp/bl1528', '/tmp/conf', FIXED_NOW_MS, deps);
  const result = runNightClosingCeremony('/tmp/bl1528', '/tmp/conf', FIXED_NOW_MS + 1000, deps);

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
  runNightClosingCeremony('/tmp/bl1528b', '/tmp/conf', FIXED_NOW_MS, deps);
  const result = runNightClosingCeremony('/tmp/bl1528b', '/tmp/conf', FIXED_NOW_MS + 1000, deps);

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
  const nowMs = FIXED_NOW_MS;
  const result = runNightClosingCeremony('/tmp/bl1640b', '/tmp/conf', nowMs, deps);
  assert.equal(result.state.drainDeadlineMs, nowMs + 25 * 60_000);
});

test('BL-1640: a second sleep after a worked shift the same day starts a new ceremony over a done state', () => {
  // Day 1: no shift of work - one tick, a quiet 'done' with no briefing sent
  // (isolates the restart mechanism from the unrelated "already briefed
  // today" short-circuit, which itself also correctly reopens as 'done').
  const { deps, state } = makeDeps({ workedAShift: () => false });
  const nowMs = FIXED_NOW_MS;
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
  const nowMs = FIXED_NOW_MS;
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
  const nowMs = FIXED_NOW_MS;
  deps.briefingSent = () => true;
  runNightClosingCeremony('/tmp/bl1640e', '/tmp/conf', nowMs, deps, false, 'finish-shift');
  assert.equal(state.current.phase, 'done');

  // No sleepPath now: this is the daemon's own sweep.
  const second = runNightClosingCeremony('/tmp/bl1640e', '/tmp/conf', nowMs + 5000, deps);
  assert.equal(second.state.phase, 'done', 'the daemon must never reopen a night it already closed');
  assert.equal(second.advanced, false);
});

// ── BL-1836: the documenter's briefing lands the moment it exists ────────

// Drives a sleep ceremony into its briefing phase, then one more tick at `at`.
function toBriefingThenTick(deps, root, at) {
  const t0 = FIXED_NOW_MS;
  runNightClosingCeremony(root, '/tmp/conf', t0, deps, false, 'finish-shift');
  runNightClosingCeremony(root, '/tmp/conf', t0 + 1000, deps, false, 'finish-shift');
  return runNightClosingCeremony(root, '/tmp/conf', t0 + at, deps, false, 'finish-shift');
}

function landingDeps(actions) {
  const onMain = { value: false };
  const made = makeDeps({
    landDocumenterBriefing: (_t, dayKey) => {
      actions.push(['land', dayKey]);
      onMain.value = true;
      return 'abcabcabcabc';
    },
    mainHasBriefing: () => onMain.value,
  });
  return made;
}

test('BL-1836: a briefing tick before the deadline lands the documenter commit and keeps waiting for the send', () => {
  const actions = [];
  const { deps } = landingDeps(actions);
  const result = toBriefingThenTick(deps, '/tmp/bl1836a', 2000);
  assert.ok(actions.some((a) => a[0] === 'land'), `landDocumenterBriefing was not called: ${JSON.stringify(actions)}`);
  assert.equal(result.state.phase, 'briefing');
  assert.ok(result.state.sequence.includes('briefing-landed-from-documenter'));
  assert.ok(!result.state.loudSurfaces.includes('closing-briefing-missing'));
});

test('BL-1836: landing at the deadline stops quietly, the landing step before swarm-stopped', () => {
  const actions = [];
  const made = landingDeps(actions);
  const result = toBriefingThenTick(made.deps, '/tmp/bl1836b', 40 * 60_000);
  assert.equal(result.state.phase, 'done');
  assert.ok(!result.state.loudSurfaces.includes('closing-briefing-missing'));
  assert.ok(!made.actions.some((a) => a[0] === 'surface'));
  const seq = result.state.sequence;
  assert.ok(seq.indexOf('briefing-landed-from-documenter') < seq.indexOf('swarm-stopped'), seq.join(' -> '));
});

test('BL-1836: no briefing anywhere at the deadline stops loud and composes nothing', () => {
  const { deps, actions } = makeDeps();
  const result = toBriefingThenTick(deps, '/tmp/bl1836c', 40 * 60_000);
  assert.deepEqual(result.state.sequence.slice(-2), ['briefing-missing', 'swarm-stopped']);
  assert.ok(actions.some((a) => a[0] === 'surface' && a[1] === 'closing-briefing-missing'));
  assert.ok(actions.some((a) => a[0] === 'stop'));
});

test('BL-1836: the frozen phase never tries to land (the documenter is not instructed yet)', () => {
  const actions = [];
  const { deps } = landingDeps(actions);
  runNightClosingCeremony('/tmp/bl1836d', '/tmp/conf', FIXED_NOW_MS, deps, false, 'finish-shift');
  assert.ok(!actions.some((a) => a[0] === 'land'));
});

test('BL-1836: a dry run never lands', () => {
  const actions = [];
  const { deps } = landingDeps(actions);
  runNightClosingCeremony('/tmp/bl1836e', '/tmp/conf', FIXED_NOW_MS, deps, false, 'finish-shift');
  runNightClosingCeremony('/tmp/bl1836e', '/tmp/conf', FIXED_NOW_MS + 1000, deps, false, 'finish-shift');
  runNightClosingCeremony('/tmp/bl1836e', '/tmp/conf', FIXED_NOW_MS + 2000, deps, true, 'finish-shift');
  assert.ok(!actions.some((a) => a[0] === 'land'));
});

test("BL-1836: a stale previous night still parked in the briefing phase never lands into today's night", () => {
  // landBriefingIfDue's guard is `prev.phase !== 'briefing'`, gated by a
  // SEPARATE `prev.nightKey !== nightKey` check - hand-mutation (removing
  // just the nightKey clause) showed this exact case uncovered: a prior
  // ceremony that crashed mid-briefing on an earlier calendar day and never
  // reached done/idle must not have its stale "I'm in briefing" phase read
  // as license to land TODAY's briefing before today's own ceremony has
  // even started (it is still phase 'idle' for today, not 'briefing').
  const actions = [];
  const { deps, state } = makeDeps({
    landDocumenterBriefing: (_t, dayKey) => {
      actions.push(['land', dayKey]);
      return 'abcabcabcabc';
    },
  });
  state.current = {
    nightKey: '2026-09-24',
    phase: 'briefing',
    sequence: ['freeze-promotion', 'drain-ended', 'briefing-instructed'],
    startedAtMs: FIXED_NOW_MS - 86_400_000,
    drainDeadlineMs: FIXED_NOW_MS - 86_400_000,
    hardDeadlineMs: FIXED_NOW_MS - 86_400_000 + 10 * 60_000,
    rotationRequested: false,
    loudSurfaces: [],
    parked: false,
    briefingInstructed: true,
    hadInFlight: false,
  };
  runNightClosingCeremony('/tmp/bl1836f', '/tmp/conf', FIXED_NOW_MS, deps, false, 'finish-shift');
  assert.ok(
    !actions.some((a) => a[0] === 'land'),
    `landDocumenterBriefing fired for the wrong night: ${JSON.stringify(actions)}`
  );
});

// ── BL-1836: .sent.json is read in the email sweep's own shape ───────────

function sentLedgerRoot(content) {
  const root = mkTmpDir('bl1836-sent-');
  fs.mkdirSync(path.join(root, 'docs', 'briefings'), { recursive: true });
  if (content !== undefined) fs.writeFileSync(path.join(root, 'docs', 'briefings', '.sent.json'), content);
  return root;
}

test("BL-1836: briefingSent reads the sweep's {\"sent\": [...]} shape", () => {
  const root = sentLedgerRoot(JSON.stringify({ sent: ['2026-09-24.md', '2026-09-25.md'] }));
  assert.equal(briefingSent(root, '2026-09-25'), true);
  assert.equal(briefingSent(root, '2026-09-26'), false);
});

test('BL-1836: a bare list, a missing file or junk is never read as sent', () => {
  assert.equal(briefingSent(sentLedgerRoot(JSON.stringify(['2026-09-25.md'])), '2026-09-25'), false);
  assert.equal(briefingSent(sentLedgerRoot(), '2026-09-25'), false);
  assert.equal(briefingSent(sentLedgerRoot('{not json'), '2026-09-25'), false);
  assert.equal(briefingSent(sentLedgerRoot(JSON.stringify({ sent: 'x' })), '2026-09-25'), false);
});

test('BL-1836: the match is exact, not a prefix - a longer entry sharing the day key is not this day sent', () => {
  // The old reader matched with `.startsWith(dayKey)`, which this ticket
  // dropped in the same change as the shape fix. Hand-mutation (restoring
  // startsWith) showed every existing test still green, because none of
  // them ever put a longer, day-key-prefixed entry in the ledger.
  const root = sentLedgerRoot(JSON.stringify({ sent: ['2026-09-250.md', '2026-09-25-extra.md'] }));
  assert.equal(briefingSent(root, '2026-09-25'), false);
});

test('BL-1836 / BL-897: the ledger key matches briefing_email_lib.bb on both sides', () => {
  const lib = fs.readFileSync(path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'briefing_email_lib.bb'), 'utf8');
  assert.equal(SENT_LEDGER_KEY, 'sent');
  assert.match(lib, new RegExp(`\\(:${SENT_LEDGER_KEY} \\(read-json`));
  assert.match(lib, new RegExp(`\\{:${SENT_LEDGER_KEY} \\(vec`));
});

test('BL-1528: a loud code from recordEmptyOutcome is surfaced the same way', () => {
  const { deps, actions } = makeDeps({
    workedAShift: () => false,
    recordEmptyOutcome: (_t, shiftKey) => {
      actions.push(['empty', shiftKey]);
      return ['closing-lean-packet-undeliverable 2026-09-13'];
    },
  });
  const result = runNightClosingCeremony('/tmp/bl1528c', '/tmp/conf', FIXED_NOW_MS, deps, false, 'finish-shift');

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

// ── BL-1676: first-run mutation debt on the pure helpers/tick, chased to
//    zero. None of these functions is exported (localDayKey, parseHmToMs,
//    withRuntimeLoudCodes, gateBypassed, ceremonyIsDue, resolveCeremonyDeadlines,
//    applyAction) - every assertion below drives them through the public
//    runNightClosingCeremony surface, same black-box shape as every test
//    above. The full Stryker re-run and per-survivor disposition table is
//    the hardener's stage (Article 1.6, BL-1577 precedent); see
//    backlog/evidence/BL-1676-coder-<date>.md for which named declaration
//    each test below targets and why.

test('BL-1676: localDayKey zero-pads a single-digit month and day in year-month-day order, and that key reaches the briefing instruction', () => {
  // FIXED_NOW_MS above (Sep 25) never exercises padStart or the getMonth()+1
  // arithmetic: both month and day are already two digits. Jan 5 forces both.
  const { deps, actions } = makeDeps();
  const t0 = new Date(2026, 0, 5, 12, 0, 0).getTime();
  runNightClosingCeremony('/tmp/bl1676-localdaykey', '/tmp/conf', t0, deps);
  const result = runNightClosingCeremony('/tmp/bl1676-localdaykey', '/tmp/conf', t0 + 1000, deps);
  assert.equal(result.state.nightKey, '2026-01-05');
  const instruct = actions.find((a) => a[0] === 'instruct');
  assert.ok(instruct, `no briefing instruction dispatched: ${JSON.stringify(actions)}`);
  assert.equal(instruct[1], '2026-01-05');
});

test('BL-1676: parseHmToMs parses the daemon-path hard deadline in local time with seconds/ms zeroed, date taken from nowMs', () => {
  // No existing test asserts the DAEMON path's hardDeadlineMs (only the
  // sleep path's sleepRelativeDeadlines, which never calls parseHmToMs).
  // nowMs carries nonzero seconds/ms on purpose, to catch a mutant that
  // forwards them instead of zeroing.
  const nowMs = new Date(2026, 0, 15, 12, 34, 56, 789).getTime();
  const { deps, actions } = makeDeps({
    evaluate: () => ({
      mode: 'ceremony',
      scheduleState: 'ok',
      surfaced: 'nothing',
      consultFixedMorningTrigger: false,
      ceremonyDue: true,
      ceremonyBeginLocal: '05:25',
      closureStopLocal: '06:30',
    }),
  });
  const result = runNightClosingCeremony('/tmp/bl1676-parsehm', '/tmp/conf', nowMs, deps);
  const expectedHardDeadline = new Date(2026, 0, 15, 6, 30, 0, 0).getTime();
  assert.equal(result.state.hardDeadlineMs, expectedHardDeadline);
  // applyAction's 'freeze' dispatch forwards this exact value - same parcel,
  // named in the census as one of applyAction's own survivors.
  assert.ok(
    actions.some((a) => a[0] === 'freeze' && a[1] === expectedHardDeadline),
    `expected a freeze action carrying the exact hard deadline: ${JSON.stringify(actions)}`
  );
});

test('BL-1676: resolveCeremonyDeadlines treats an empty-string sleepPath as a sleep, not as null, using the conf budgets', () => {
  // The guard is `sleepPath !== null`, never a truthiness check - an empty
  // string is a sleep trigger same as any other non-null value. A mutant
  // weakening this to a truthiness check would route '' to the daemon's
  // hardcoded 25-minute budget instead.
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
  const nowMs = FIXED_NOW_MS;
  const result = runNightClosingCeremony('/tmp/bl1676-emptysleep', '/tmp/conf', nowMs, deps, false, '');
  assert.equal(result.state.drainDeadlineMs, nowMs + 2 * 60_000);
  assert.equal(result.state.hardDeadlineMs, nowMs + 3 * 60_000);
});

test("BL-1676: ceremonyIsDue treats any truthy gate value as due, not only the literal boolean true", () => {
  const { deps } = makeDeps({
    evaluate: () => ({ mode: 'ceremony', scheduleState: 'ok', surfaced: 'nothing', ceremonyDue: 'yes' }),
  });
  const result = runNightClosingCeremony('/tmp/bl1676-truthy-due', '/tmp/conf', FIXED_NOW_MS, deps);
  assert.equal(result.gateMode, 'ceremony');
  assert.equal(result.advanced, true, 'a truthy (non-boolean) ceremonyDue must still start the ceremony');
});

test("BL-1676: applyAction's record-cnp case forwards the exact held-parcel ids to recordCnp, unmutated", () => {
  // No existing test ever makes scanHeld return a non-empty list, so the
  // 'record-cnp' case of applyAction's switch was unreached entirely.
  const { deps, actions } = makeDeps({ scanHeld: () => ['001234_from_coder', '005678_from_hardener'] });
  runNightClosingCeremony('/tmp/bl1676-cnp', '/tmp/conf', FIXED_NOW_MS, deps);
  const cnp = actions.find((a) => a[0] === 'cnp');
  assert.ok(cnp, `no 'record-cnp' action dispatched: ${JSON.stringify(actions)}`);
  assert.deepEqual(cnp[1], ['001234_from_coder', '005678_from_hardener']);
});

// ── BL-1676 hardener pass: the full-suite Stryker re-run found real
//    survivors beyond what the coder chased - each test below targets one,
//    named in this parcel's own evidence (BL-1676-night-closing-ceremony-run-mutation.md).

test('BL-1676: a bypassed gate never writes state or dispatches any action, even though the pure machine would otherwise run', () => {
  // gateBypassed's own survivors (and the if-statement mutants at its call
  // site, which share the same observable effect) all collapse to "the
  // early return never fires" - the cheapest discriminator is that NO
  // writeState call happens: the early-return path returns
  // deps.readState(target) directly, the normal path always calls
  // deps.writeState with a fresh idleState object.
  const { deps, actions, state } = makeDeps({
    evaluate: () => ({ mode: 'off', scheduleState: 'ok', surfaced: 'nothing', ceremonyDue: false }),
  });
  const gated = runNightClosingCeremony('/tmp/bl1676-bypassed', '/tmp/conf', FIXED_NOW_MS, deps);
  assert.equal(gated.advanced, false);
  assert.deepEqual(gated.actions, [], 'the early-return result itself carries no actions');
  assert.deepEqual(actions, [], 'no dep handler fires on a bypassed tick');
  assert.equal(state.current, null, 'a bypassed gate must never write state - the early return skips writeState entirely');
});

test('BL-1676: a non-bypassed daemon tick with the gate not due stays idle, writes an idle state, and reports not advanced', () => {
  // Distinguishes this from the bypassed case above (mode 'ceremony' never
  // bypasses) and separately pins ceremonyIsDue's false branch (no sleep
  // path, a falsy gate value) and ceremonyHasAdvanced's null-prev arm
  // (prev is still null on this very first tick).
  const { deps, state } = makeDeps({
    evaluate: () => ({ mode: 'ceremony', scheduleState: 'ok', surfaced: 'nothing', ceremonyDue: false }),
  });
  const result = runNightClosingCeremony('/tmp/bl1676-notdue', '/tmp/conf', FIXED_NOW_MS, deps);
  assert.equal(result.advanced, false);
  assert.equal(result.state.phase, 'idle');
  assert.equal(state.current.phase, 'idle', 'the idle state is really written, not merely returned');
});

test('BL-1676: the first tick of a new night reports advanced true via the actions-produced arm', () => {
  // No existing test ever asserts .advanced on the TRUE side - every prior
  // assertion on .advanced checks the false case only.
  const { deps } = makeDeps();
  const result = runNightClosingCeremony('/tmp/bl1676-advancedtrue', '/tmp/conf', FIXED_NOW_MS, deps);
  assert.equal(result.advanced, true);
  assert.ok(result.actions.length > 0, 'sanity: the pure machine really produced actions this tick');
});

test('BL-1676: ceremonyHasAdvanced is false when actions fire but the phase does not change (the || must not become &&)', () => {
  // A hand-crafted previous state already in 'briefing' phase with
  // briefingInstructed false (constructible via direct state injection,
  // same technique as the "stale previous night" test above) reaches
  // advanceBriefing's "not yet instructed" arm: it stays in 'briefing'
  // (no phase change) while still emitting the instruct-briefing action.
  // Original (||) short-circuits true on actions.length>0 alone; a
  // weakened (&&) would additionally require the phase to have changed,
  // which it has not, and would wrongly report advanced:false.
  const { deps, actions, state } = makeDeps();
  state.current = {
    nightKey: '2026-09-25',
    phase: 'briefing',
    sequence: ['freeze-promotion', 'drain-ended'],
    startedAtMs: FIXED_NOW_MS - 60_000,
    drainDeadlineMs: FIXED_NOW_MS - 30_000,
    hardDeadlineMs: FIXED_NOW_MS + 10 * 60_000,
    rotationRequested: false,
    loudSurfaces: [],
    parked: false,
    briefingInstructed: false,
    hadInFlight: false,
  };
  const result = runNightClosingCeremony('/tmp/bl1676-instructnochange', '/tmp/conf', FIXED_NOW_MS, deps);
  assert.equal(result.state.phase, 'briefing', 'sanity: the phase genuinely did not change');
  assert.ok(actions.some((a) => a[0] === 'instruct'), 'sanity: an action genuinely fired');
  assert.equal(result.advanced, true, 'actions alone must be enough, with no phase change required');
});

test("BL-1676: isContinuingInProgressNight requires the SAME night - a stale frozen state from an earlier day must not force ceremonyDue for a gate that is not yet due", () => {
  // isContinuingInProgressNight's nightKey clause is what makes this false
  // for a cross-day stale state. Flipping that clause (a mutant) wrongly
  // overrides obs.ceremonyDue to true even though prev belongs to an
  // EARLIER night - advanceNightClosingCeremony's own independent
  // `sameNight` check (prev.nightKey === obs.nightKey) still correctly
  // reads false here, which routes to the ceremonyDue-gated branch
  // (`!sameNight || ...`); with the override wrongly firing, that branch's
  // own `!obs.ceremonyDue` test flips, skipping the "leave the stale state
  // alone" return and falling through into advanceFrozen/enterBriefing
  // instead - a real freeze/briefing sequence starting for a night that
  // is not due.
  const { deps, actions, state } = makeDeps({
    evaluate: () => ({ mode: 'ceremony', scheduleState: 'ok', surfaced: 'nothing', ceremonyDue: false }),
  });
  state.current = {
    nightKey: '2026-09-20',
    phase: 'frozen',
    sequence: ['freeze-promotion'],
    startedAtMs: FIXED_NOW_MS - 5 * 86_400_000,
    drainDeadlineMs: FIXED_NOW_MS - 5 * 86_400_000,
    hardDeadlineMs: FIXED_NOW_MS - 5 * 86_400_000 + 10 * 60_000,
    rotationRequested: false,
    loudSurfaces: [],
    parked: false,
    briefingInstructed: false,
    hadInFlight: false,
  };
  const result = runNightClosingCeremony('/tmp/bl1676-staleresets', '/tmp/conf', FIXED_NOW_MS, deps);
  assert.equal(result.advanced, false, 'the new night is not due; a stale earlier night must not force it due');
  assert.equal(result.state.phase, 'frozen', 'the stale state is left exactly as it was, never advanced into briefing');
  assert.deepEqual(actions, [], 'no freeze, lean-packet, rotate or instruct action should fire for a not-due new night');
});

test("BL-1676: isContinuingInProgressNight excludes an already-idle same-night state - idle is not 'in progress'", () => {
  // The mirror of the cross-day test above: here nightKey MATCHES (same
  // night) but phase is 'idle', which the function's own fourth clause
  // must exclude. advanceNightClosingCeremony's own `phase === 'idle'`
  // check independently routes an idle prev into the SAME
  // ceremonyDue-gated branch regardless of sameNight - so if the override
  // wrongly fires here too, `!obs.ceremonyDue` flips and the branch calls
  // startFrozen(obs) instead of leaving the idle state untouched.
  const { deps, actions, state } = makeDeps({
    evaluate: () => ({ mode: 'ceremony', scheduleState: 'ok', surfaced: 'nothing', ceremonyDue: false }),
  });
  state.current = {
    nightKey: '2026-09-25',
    phase: 'idle',
    sequence: [],
    startedAtMs: FIXED_NOW_MS,
    drainDeadlineMs: FIXED_NOW_MS,
    hardDeadlineMs: FIXED_NOW_MS,
    rotationRequested: false,
    loudSurfaces: [],
    parked: false,
    briefingInstructed: false,
    hadInFlight: false,
  };
  const result = runNightClosingCeremony('/tmp/bl1676-idlesamenight', '/tmp/conf', FIXED_NOW_MS, deps);
  assert.equal(result.advanced, false, 'an idle state with the gate not due must not be forced due');
  assert.equal(result.state.phase, 'idle', 'the idle state is left exactly as it was, never promoted to frozen');
  assert.deepEqual(actions, [], 'no freeze or any other action should fire');
});

test("BL-1676: applyAction never calls a dep handler or writes state during a dry run, even when the pure machine produces real actions", () => {
  const { deps, actions, state } = makeDeps();
  const result = runNightClosingCeremony('/tmp/bl1676-dryrun', '/tmp/conf', FIXED_NOW_MS, deps, true);
  assert.ok(result.actions.length > 0, 'sanity: the pure machine really did produce actions this tick');
  assert.deepEqual(actions, [], 'a dry run must call no dep handler even though actions were produced');
  assert.equal(state.current, null, 'a dry run must never write state either');
  // applyAction's dry-run branch returns [] (no runtime loud codes) rather
  // than running a handler - that return value still flows into
  // withRuntimeLoudCodes and the RETURNED (not written) result.state
  // regardless of dryRun, so a mutant corrupting it is observable here
  // even though no dep handler fires and nothing is written.
  assert.deepEqual(result.state.loudSurfaces, [], 'a dry run must report no runtime loud codes either');
});

test("BL-1676: applyAction's record-cnp case never leaks its handler's own return value into loudSurfaces", () => {
  const { deps } = makeDeps({ scanHeld: () => ['001234_from_coder'] });
  const result = runNightClosingCeremony('/tmp/bl1676-cnp-loud', '/tmp/conf', FIXED_NOW_MS, deps);
  assert.deepEqual(result.state.loudSurfaces, [], 'record-cnp reports no send outcome and must fold nothing into loudSurfaces');
});

test('BL-1676: resolveCeremonyDeadlines defaults the daemon path\'s hard deadline to 06:00 when the gate omits closureStopLocal', () => {
  const { deps } = makeDeps({
    evaluate: () => ({ mode: 'ceremony', scheduleState: 'ok', surfaced: 'nothing', ceremonyDue: true }),
  });
  const nowMs = new Date(2026, 0, 20, 3, 0, 0).getTime();
  const result = runNightClosingCeremony('/tmp/bl1676-defaultclosure', '/tmp/conf', nowMs, deps);
  assert.equal(result.state.hardDeadlineMs, new Date(2026, 0, 20, 6, 0, 0).getTime());
});

test('BL-1676: mainHasBriefing is keyed on the exact dayKey, never a fixed path', () => {
  const root = gitFixture();
  fs.mkdirSync(path.join(root, 'docs', 'briefings'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'briefings', '2026-09-08.md'), '# briefing\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'add briefing'], { cwd: root });
  assert.equal(mainHasBriefing(root, '2026-09-08'), true);
  assert.equal(mainHasBriefing(root, '2026-09-09'), false, 'a different day key must read as absent, not reuse the other key\'s answer');
});

test('BL-1676: withRuntimeLoudCodes appends a runtime-discovered loud code after the pure decision\'s own, never dropping or reordering it', () => {
  // The pure machine decides 'closing-drain-deadline-exceeded' itself
  // (enterBriefing, parked path); deliverLeanPacket's own return value is
  // discovered only at applyAction time and folded in by withRuntimeLoudCodes.
  // Order and survival of BOTH entries pins the spread (never `[]` or
  // `[...runtimeLoudCodes]` alone, never reordered).
  const { deps } = makeDeps({
    scanInFlight: () => ({ count: 1, roles: ['coder'] }),
    deliverLeanPacket: () => ['closing-lean-packet-undeliverable 2026-09-25'],
  });
  const t0 = FIXED_NOW_MS;
  runNightClosingCeremony('/tmp/bl1676-order', '/tmp/conf', t0, deps);
  const result = runNightClosingCeremony('/tmp/bl1676-order', '/tmp/conf', t0 + 25 * 60_000, deps);
  assert.deepEqual(result.state.loudSurfaces, [
    'closing-drain-deadline-exceeded',
    'closing-lean-packet-undeliverable 2026-09-25',
  ]);
});
