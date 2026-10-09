const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  CHECKLIST,
  runChecklist,
  buildRegisterJoin,
  parseFailingFilesFromVitestOutput,
  failingFilesFromRow,
  readAcceptancePath,
  tailExcerpt,
  composeQaGatherReport,
  parseRegisterOutput,
  EXCERPT_MAX_CHARS,
  backlogOnlySkipReason,
} = require('../out/quality/qaGather');
const { findTicketYamlContent, gatherQaChecklist, defaultRunFn } = require('../out/metrics/qaGatherAdapter');

// ── CHECKLIST shape and order (BL-1554 invariant 3) ────────────────────

test('the checklist is the fixed 9 checks in the fixed order', () => {
  assert.deepEqual(
    CHECKLIST.map((c) => c.id),
    ['stragglers_before', 'sibling', 'register', 'wiring', 'unit', 'properties', 'property_runners', 'acceptance', 'stragglers_after'],
  );
});

test('every CHECKLIST check build()s its exact command, args and cwd for a fully-populated context', () => {
  const ctx = { root: '/r', ticketId: 'BL-1', task: 't', commit: 'abc1234567', mergeBaseWithMain: 'base0001ab', acceptanceFeature: 'f.feature' };
  const builtById = new Map(CHECKLIST.map((c) => [c.id, c.build(ctx)]));
  assert.deepEqual(builtById.get('sibling'), {
    command: 'node',
    args: [path.join('extension', 'out', 'tools', 'qa-sibling-check.js'), 'status', '--ticket', 'BL-1'],
    cwd: '/r',
  });
  assert.deepEqual(builtById.get('register'), {
    command: 'bb',
    args: [path.join('swarmforge', 'scripts', 'standing_red_register_cli.bb'), '/r'],
    cwd: '/r',
  });
  assert.deepEqual(builtById.get('wiring'), {
    command: path.join('/r', 'swarmforge', 'scripts', 'pre_qa_gate.sh'),
    args: ['t', 'abc1234567', '/r'],
    cwd: '/r',
  });
  assert.deepEqual(builtById.get('unit'), { command: 'npm', args: ['test'], cwd: path.join('/r', 'extension') });
  assert.deepEqual(builtById.get('properties'), { command: 'npm', args: ['run', 'test:properties'], cwd: path.join('/r', 'extension') });
  assert.deepEqual(builtById.get('acceptance'), {
    command: path.join('/r', 'specs', 'pipeline', 'scripts', 'run_acceptance.sh'),
    args: ['f.feature'],
    cwd: '/r',
  });
});

// ── runChecklist: sequential, blocked handling, never a verdict ────────

function fakeRunner(script) {
  const calls = [];
  const runFn = (command, args, cwd) => {
    calls.push({ command, args, cwd, at: calls.length });
    const key = args.join(' ');
    const answer = script[command] ?? script[key] ?? script.default;
    if (!answer) {
      return { started: true, exit: 0, stdout: '', stderr: '' };
    }
    return answer;
  };
  return { runFn, calls };
}

test('runChecklist runs every check and never skips one on a blocked prerequisite', () => {
  const { runFn } = fakeRunner({ default: { started: true, exit: 0, stdout: 'ok', stderr: '' } });
  const rows = runChecklist(CHECKLIST, { root: '/r', ticketId: 'BL-1', commit: 'abc1234567', mergeBaseWithMain: 'base0001ab' }, runFn);
  assert.equal(rows.length, CHECKLIST.length);
  assert.deepEqual(rows.map((r) => r.id), CHECKLIST.map((c) => c.id));
  // no --task and no acceptanceFeature -> wiring and acceptance are
  // blocked WITHOUT ever calling runFn, but every other check still ran.
  const wiring = rows.find((r) => r.id === 'wiring');
  const acceptance = rows.find((r) => r.id === 'acceptance');
  assert.equal(wiring.status, 'blocked');
  assert.match(wiring.reason, /--task/);
  assert.equal(wiring.command, '');
  assert.equal(wiring.excerpt, '');
  assert.equal(acceptance.status, 'blocked');
  assert.match(acceptance.reason, /acceptance/);
  assert.equal(acceptance.command, '');
  assert.equal(acceptance.excerpt, '');
  for (const row of rows) {
    if (row.id !== 'wiring' && row.id !== 'acceptance') {
      assert.equal(row.status, 'ran');
      assert.equal(row.exit, 0);
    }
  }
});

// ── BL-2094: the property_runners row ───────────────────────────────────
// (BL-2073 passed ctx.commit - the gathered commit itself, which IS HEAD
// when QA gathers - directly as --changed-from, collapsing the front-end's
// own diff range to empty on every real gather. The row now reads the
// merge-base-with-main composeQaGatherReport resolves onto ctx, never
// ctx.commit directly.)

test('the property_runners row builds the front-end command with the resolved merge-base ref, never the gathered commit', () => {
  const spec = CHECKLIST.find((c) => c.id === 'property_runners');
  const built = spec.build({ root: '/r', ticketId: 'BL-1', commit: 'abc1234567', mergeBaseWithMain: 'base0001ab' });
  assert.equal(built.command, path.join('/r', 'swarmforge', 'scripts', 'test', 'run_property_runners.sh'));
  assert.deepEqual(built.args, ['--changed-from', 'base0001ab']);
  assert.equal(built.cwd, '/r');
});

test('the property_runners row is blocked with a reason naming the failed merge-base when it cannot be resolved', () => {
  const spec = CHECKLIST.find((c) => c.id === 'property_runners');
  const built = spec.build({ root: '/r', ticketId: 'BL-1', commit: 'unknown' }); // mergeBaseWithMain absent
  assert.equal(built.blockedReason, 'could not resolve merge-base main unknown');
});

test('the property_runners row is blocked even when ctx.commit itself looks like a real sha, if the merge-base could not be resolved', () => {
  const spec = CHECKLIST.find((c) => c.id === 'property_runners');
  const built = spec.build({ root: '/r', ticketId: 'BL-1', commit: 'abc1234567' }); // mergeBaseWithMain absent
  assert.equal(built.blockedReason, 'could not resolve merge-base main abc1234567');
});

test('the property_runners row runs the front-end with the resolved merge-base ref and reads its exit and output', () => {
  const { runFn, calls } = fakeRunner({
    default: { started: true, exit: 0, stdout: '', stderr: '' },
  });
  const rows = runChecklist(
    CHECKLIST,
    { root: '/r', ticketId: 'BL-1', commit: 'abc1234567', mergeBaseWithMain: 'base0001ab', task: 't', acceptanceFeature: 'f.feature' },
    runFn
  );
  const row = rows.find((r) => r.id === 'property_runners');
  assert.equal(row.status, 'ran');
  assert.equal(row.exit, 0);
  const call = calls.find((c) => c.command.includes('run_property_runners.sh'));
  assert.ok(call, 'the front-end command was not started');
  assert.deepEqual(call.args, ['--changed-from', 'base0001ab']);
  assert.equal(call.cwd, '/r');
});

test('composeQaGatherReport resolves mergeBaseWithMain via merge-base main <commit> through runFn and feeds it to the row', () => {
  const { runFn, calls } = fakeRunner({
    'merge-base main abc1234567': { started: true, exit: 0, stdout: 'base0001ab\n', stderr: '' },
    default: { started: true, exit: 0, stdout: '', stderr: '' },
  });
  const report = composeQaGatherReport('/r', 'BL-9999', { commit: 'abc1234567' }, runFn, undefined);
  const row = report.checks.find((c) => c.id === 'property_runners');
  assert.equal(row.status, 'ran');
  const mergeBaseCall = calls.find((c) => c.command === 'git' && c.args.join(' ') === 'merge-base main abc1234567');
  assert.ok(mergeBaseCall, 'expected a merge-base main <commit> call');
  const frontEndCall = calls.find((c) => c.command.includes('run_property_runners.sh'));
  assert.deepEqual(frontEndCall.args, ['--changed-from', 'base0001ab']);
});

test('composeQaGatherReport blocks the property_runners row when merge-base cannot be resolved (never started, non-zero exit, or empty stdout)', () => {
  for (const mergeBaseAnswer of [
    { started: false, exit: null, stdout: '', stderr: '', reason: 'boom' },
    { started: true, exit: 1, stdout: '', stderr: 'boom' },
    { started: true, exit: 0, stdout: '', stderr: '' },
  ]) {
    const { runFn } = fakeRunner({
      'merge-base main abc1234567': mergeBaseAnswer,
      default: { started: true, exit: 0, stdout: '', stderr: '' },
    });
    const report = composeQaGatherReport('/r', 'BL-9999', { commit: 'abc1234567' }, runFn, undefined);
    const row = report.checks.find((c) => c.id === 'property_runners');
    assert.equal(row.status, 'blocked', `expected blocked for merge-base answer ${JSON.stringify(mergeBaseAnswer)}`);
    assert.equal(row.reason, 'could not resolve merge-base main abc1234567');
  }
});

// The three cases above all answer a failed merge-base with EMPTY stdout,
// same as a real git failure in practice - but that also means a
// guard-removal mutant (e.g. "if (false)" in place of the started/exit
// check) still falls through to an empty base and lands on the SAME
// blocked result by coincidence (the fake-runGit trap: "a status!==0
// guard needs non-empty matching stdout on the failing call"). This gives
// the failing call a non-empty stdout so a guard-removal mutant diverges
// for real: skipping the guard would carry that bogus value all the way
// to a started front-end call.
test('composeQaGatherReport blocks the property_runners row when merge-base exits non-zero even if it printed something to stdout', () => {
  const { runFn, calls } = fakeRunner({
    'merge-base main abc1234567': { started: true, exit: 1, stdout: 'bogus-base-sha\n', stderr: 'ambiguous argument' },
    default: { started: true, exit: 0, stdout: '', stderr: '' },
  });
  const report = composeQaGatherReport('/r', 'BL-9999', { commit: 'abc1234567' }, runFn, undefined);
  const row = report.checks.find((c) => c.id === 'property_runners');
  assert.equal(row.status, 'blocked');
  assert.equal(row.reason, 'could not resolve merge-base main abc1234567');
  assert.ok(!calls.some((c) => c.command.includes('run_property_runners.sh')), 'the front-end must never be started on a failed merge-base');
});

test('a check the runner cannot start is reported blocked with the runner\'s own reason, and later checks still run', () => {
  const { runFn, calls } = fakeRunner({
    node: { started: false, exit: null, stdout: '', stderr: '', reason: 'ENOENT: no such file' },
    default: { started: true, exit: 0, stdout: '', stderr: '' },
  });
  const rows = runChecklist(
    CHECKLIST,
    { root: '/r', ticketId: 'BL-1', commit: 'abc1234567', mergeBaseWithMain: 'base0001ab', task: 't', acceptanceFeature: 'f.feature' },
    runFn
  );
  const sibling = rows.find((r) => r.id === 'sibling');
  assert.equal(sibling.status, 'blocked');
  assert.equal(sibling.reason, 'ENOENT: no such file');
  // a runner-cannot-start row still names the command that was attempted
  // (unlike a prerequisite-blocked row, which never had one), but never
  // any output text, since nothing ran.
  assert.equal(sibling.command, `node ${path.join('extension', 'out', 'tools', 'qa-sibling-check.js')} status --ticket BL-1`);
  assert.equal(sibling.excerpt, '');
  // every check after sibling was still started (only sibling's own
  // command uses `node`, so the count of started calls after it is every
  // remaining check).
  const afterSibling = rows.slice(rows.findIndex((r) => r.id === 'sibling') + 1);
  assert.ok(afterSibling.every((r) => r.status === 'ran'));
  assert.equal(calls.length, CHECKLIST.length); // every build produced a real command in this fixture
});

test('a check the runner cannot start is reported blocked with "could not start" when the runner gives no reason of its own', () => {
  const { runFn } = fakeRunner({
    node: { started: false, exit: null, stdout: '', stderr: '' },
    default: { started: true, exit: 0, stdout: '', stderr: '' },
  });
  const rows = runChecklist(CHECKLIST, { root: '/r', ticketId: 'BL-1', commit: 'abc1234567', mergeBaseWithMain: 'base0001ab' }, runFn);
  const sibling = rows.find((r) => r.id === 'sibling');
  assert.equal(sibling.status, 'blocked');
  assert.equal(sibling.reason, 'could not start');
});

test('runChecklist never runs two checks concurrently: every call is issued strictly after the previous one returned', () => {
  const order = [];
  let active = 0;
  const runFn = () => {
    active += 1;
    assert.equal(active, 1, 'a second check started before the first ended');
    order.push('start');
    active -= 1;
    order.push('end');
    return { started: true, exit: 0, stdout: '', stderr: '' };
  };
  runChecklist(
    CHECKLIST,
    { root: '/r', ticketId: 'BL-1', commit: 'abc1234567', mergeBaseWithMain: 'base0001ab', task: 't', acceptanceFeature: 'f.feature' },
    runFn
  );
  // strict start/end/start/end/... alternation, once per check.
  assert.deepEqual(order, CHECKLIST.flatMap(() => ['start', 'end']));
});

test('runChecklist reports the row shape a report reader needs: command, cwd, status, exit, duration_ms, excerpt', () => {
  const { runFn } = fakeRunner({ default: { started: true, exit: 3, stdout: 'out', stderr: 'err' } });
  const rows = runChecklist([CHECKLIST[0]], { root: '/r', ticketId: 'BL-1', commit: 'abc1234567' }, runFn);
  const [row] = rows;
  assert.equal(row.command, 'pgrep -fl node --test|stryker|vitest');
  assert.equal(row.cwd, '/r');
  assert.equal(row.status, 'ran');
  assert.equal(row.exit, 3);
  // Bounded, not just non-negative: `Date.now() + startedAt` (an
  // arithmetic-sign mutant) is also >= 0, since both operands are large
  // positive epoch-ms numbers - it lands in the trillions, so a real
  // upper bound is what actually discriminates the subtraction from it.
  assert.ok(row.duration_ms >= 0 && row.duration_ms < 60000, `duration_ms out of a sane bound: ${row.duration_ms}`);
  assert.equal(row.excerpt, 'outerr');
});

test('runChecklist calls onRawOutcome with the UNBOUNDED outcome for a check that ran, never for a blocked one', () => {
  const longStdout = 'x'.repeat(5000);
  const { runFn } = fakeRunner({ default: { started: true, exit: 0, stdout: longStdout, stderr: '' } });
  const raw = new Map();
  const rows = runChecklist(CHECKLIST, { root: '/r', ticketId: 'BL-1', commit: 'abc1234567' }, runFn, (id, outcome) => {
    raw.set(id, outcome.stdout);
  });
  // every check that actually ran (all but the two blocked-by-missing-
  // prerequisite ones, wiring/acceptance, since no --task/acceptance
  // feature was given) reported its raw, full-length stdout - never the
  // row's own bounded `excerpt`.
  const ranIds = rows.filter((r) => r.status === 'ran').map((r) => r.id);
  assert.deepEqual([...raw.keys()].sort(), ranIds.slice().sort());
  for (const id of ranIds) {
    assert.equal(raw.get(id).length, 5000);
  }
  assert.ok(!raw.has('wiring'));
  assert.ok(!raw.has('acceptance'));
});

test('no row ever carries a verdict-shaped field', () => {
  const { runFn } = fakeRunner({ default: { started: true, exit: 1, stdout: 'x', stderr: '' } });
  const rows = runChecklist(CHECKLIST, { root: '/r', ticketId: 'BL-1', commit: 'abc1234567', task: 't', acceptanceFeature: 'f.feature' }, runFn);
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      assert.ok(!/verdict|pass|bounce|approve/i.test(key), `row key "${key}" looks like a verdict field`);
    }
  }
});

// ── BL-2024: backlog-only parcel skips the unit/properties lanes ────────
// (BL-2024/BL-2094 integration bounce, 2026-10-09: backlogOnlySkipReason
// no longer resolves the merge-base itself - it takes the ALREADY-RESOLVED
// base as its own parameter, one level up now at composeQaGatherReport.
// Every test below passes `base` directly; the merge-base-resolution
// failure modes moved to resolveMergeBaseWithMain's own tests/property
// test and to composeQaGatherReport's tests further down this file.)

test('backlogOnlySkipReason returns a reason when the diff is non-empty and every path starts with backlog/', () => {
  const runFn = fakeRunner({
    'diff --no-renames --name-only basesha0001 abc1234567': { started: true, exit: 0, stdout: 'backlog/evidence/BL-9001-coder.md\n', stderr: '' },
  }).runFn;
  const reason = backlogOnlySkipReason('/r', 'basesha0001', 'abc1234567', runFn);
  assert.ok(typeof reason === 'string' && reason.length > 0);
  assert.match(reason, /backlog\//);
});

test('backlogOnlySkipReason returns undefined when any path is outside backlog/, even alongside backlog/ paths', () => {
  const runFn = fakeRunner({
    'diff --no-renames --name-only basesha0001 abc1234567': {
      started: true,
      exit: 0,
      stdout: 'backlog/evidence/BL-9001-coder.md\nextension/src/tools/bl9001.ts\n',
      stderr: '',
    },
  }).runFn;
  assert.equal(backlogOnlySkipReason('/r', 'basesha0001', 'abc1234567', runFn), undefined);
});

test('backlogOnlySkipReason returns undefined when the diff is empty', () => {
  const runFn = fakeRunner({
    'diff --no-renames --name-only basesha0001 abc1234567': { started: true, exit: 0, stdout: '', stderr: '' },
  }).runFn;
  assert.equal(backlogOnlySkipReason('/r', 'basesha0001', 'abc1234567', runFn), undefined);
});

test('backlogOnlySkipReason returns undefined when the diff itself cannot be resolved (never started, or a non-zero exit)', () => {
  assert.equal(
    backlogOnlySkipReason(
      '/r', 'basesha0001', 'abc1234567',
      fakeRunner({ 'diff --no-renames --name-only basesha0001 abc1234567': { started: false, exit: null, stdout: '', stderr: '', reason: 'boom' } }).runFn
    ),
    undefined
  );
  assert.equal(
    backlogOnlySkipReason(
      '/r', 'basesha0001', 'abc1234567',
      fakeRunner({ 'diff --no-renames --name-only basesha0001 abc1234567': { started: true, exit: 1, stdout: '', stderr: 'boom' } }).runFn
    ),
    undefined
  );
});

// BL-2063-class fake-runner trap: "A fake-runGit test for a status!==0
// guard needs non-empty matching stdout on the failing call - empty
// stdout collapses both branches". Gives the failing diff call a
// non-empty, backlog-only-shaped stdout so a guard-removal mutant
// diverges for real: skipping the exit-check would carry that bogus
// value all the way to a non-undefined skip reason.
test('backlogOnlySkipReason returns undefined when diff exits non-zero even if it printed something to stdout', () => {
  const runFn = fakeRunner({
    'diff --no-renames --name-only basesha0001 abc1234567': { started: true, exit: 1, stdout: 'backlog/evidence/sneaky.md\n', stderr: 'boom' },
  }).runFn;
  assert.equal(backlogOnlySkipReason('/r', 'basesha0001', 'abc1234567', runFn), undefined);
});

test('backlogOnlySkipReason trims each diff path before checking backlog/, never matching one with leading/trailing whitespace untrimmed', () => {
  const runFn = fakeRunner({
    'diff --no-renames --name-only basesha0001 abc1234567': { started: true, exit: 0, stdout: ' backlog/evidence/BL-9001-coder.md \n', stderr: '' },
  }).runFn;
  const reason = backlogOnlySkipReason('/r', 'basesha0001', 'abc1234567', runFn);
  assert.ok(typeof reason === 'string' && reason.length > 0, 'a path that is backlog/-only once trimmed must still skip');
  assert.match(reason, /backlog\/evidence\/BL-9001-coder\.md/);
});

test('backlogOnlySkipReason joins multiple backlog/ paths with ", " in the reason, exactly', () => {
  const runFn = fakeRunner({
    'diff --no-renames --name-only basesha0001 abc1234567': {
      started: true,
      exit: 0,
      stdout: 'backlog/evidence/BL-9001-coder.md\nbacklog/evidence/BL-9001-architect.md\n',
      stderr: '',
    },
  }).runFn;
  const reason = backlogOnlySkipReason('/r', 'basesha0001', 'abc1234567', runFn);
  assert.equal(reason, "the parcel's own diff touches only backlog/ (backlog/evidence/BL-9001-coder.md, backlog/evidence/BL-9001-architect.md)");
});

// composeQaGatherReport-level: the ONE merge-base resolution's failure
// cascades to BOTH ctx.mergeBaseWithMain and ctx.backlogOnlySkipReason
// (never calling the diff at all for the latter) - the "empty base"/
// "merge-base cannot be resolved" guards this integration now owns,
// since backlogOnlySkipReason itself no longer resolves a merge-base.
test('composeQaGatherReport: a failed merge-base leaves both mergeBaseWithMain and backlogOnlySkipReason unset, and never attempts the backlog-only diff', () => {
  for (const mergeBaseAnswer of [
    { started: false, exit: null, stdout: '', stderr: '', reason: 'boom' },
    { started: true, exit: 1, stdout: 'should-be-ignored-sha\n', stderr: 'ambiguous argument' },
    { started: true, exit: 0, stdout: '\n', stderr: '' },
  ]) {
    const { runFn, calls } = fakeRunner({
      'merge-base main abc1234567': mergeBaseAnswer,
      default: { started: true, exit: 0, stdout: 'backlog/evidence/BL-9001-coder.md\n', stderr: '' },
    });
    const report = composeQaGatherReport('/r', 'BL-9999', { commit: 'abc1234567' }, runFn, undefined);
    const diffCalls = calls.filter((c) => c.args[0] === 'diff');
    assert.deepEqual(diffCalls, [], `expected no diff call for merge-base answer ${JSON.stringify(mergeBaseAnswer)}`);
    const propertyRunnersRow = report.checks.find((c) => c.id === 'property_runners');
    assert.equal(propertyRunnersRow.status, 'blocked', `expected property_runners blocked for ${JSON.stringify(mergeBaseAnswer)}`);
    const unitRow = report.checks.find((c) => c.id === 'unit');
    const propsRow = report.checks.find((c) => c.id === 'properties');
    assert.notEqual(unitRow.status, 'skipped', 'backlogOnlySkipReason must never fire off an unresolved merge-base');
    assert.notEqual(propsRow.status, 'skipped', 'backlogOnlySkipReason must never fire off an unresolved merge-base');
  }
});

test("the unit and properties checks' build() skip without ever building a command when ctx.backlogOnlySkipReason is set", () => {
  const ctx = { root: '/r', ticketId: 'BL-1', commit: 'abc1234567', backlogOnlySkipReason: 'the parcel only touches backlog/' };
  const unitBuilt = CHECKLIST.find((c) => c.id === 'unit').build(ctx);
  const propsBuilt = CHECKLIST.find((c) => c.id === 'properties').build(ctx);
  assert.deepEqual(unitBuilt, { skippedReason: 'the parcel only touches backlog/' });
  assert.deepEqual(propsBuilt, { skippedReason: 'the parcel only touches backlog/' });
});

test("the unit and properties checks' build() run normally when ctx.backlogOnlySkipReason is unset", () => {
  const ctx = { root: '/r', ticketId: 'BL-1', commit: 'abc1234567' };
  const unitBuilt = CHECKLIST.find((c) => c.id === 'unit').build(ctx);
  const propsBuilt = CHECKLIST.find((c) => c.id === 'properties').build(ctx);
  assert.equal(unitBuilt.command, 'npm');
  assert.deepEqual(unitBuilt.args, ['test']);
  assert.equal(propsBuilt.command, 'npm');
  assert.deepEqual(propsBuilt.args, ['run', 'test:properties']);
});

test('runChecklist reports a skipped build as status "skipped" with its reason, calls no runFn for it, and never calls onRawOutcome for it', () => {
  const { runFn, calls } = fakeRunner({ default: { started: true, exit: 0, stdout: 'ok', stderr: '' } });
  const raw = new Map();
  const ctx = {
    root: '/r',
    ticketId: 'BL-1',
    commit: 'abc1234567',
    mergeBaseWithMain: 'base0001ab',
    task: 't',
    acceptanceFeature: 'f.feature',
    backlogOnlySkipReason: 'only backlog/',
  };
  const rows = runChecklist(CHECKLIST, ctx, runFn, (id, outcome) => raw.set(id, outcome.stdout));
  const unitRow = rows.find((r) => r.id === 'unit');
  const propsRow = rows.find((r) => r.id === 'properties');
  assert.deepEqual(
    [unitRow, propsRow].map((r) => ({ status: r.status, command: r.command, excerpt: r.excerpt, exit: r.exit, reason: r.reason })),
    [
      { status: 'skipped', command: '', excerpt: '', exit: null, reason: 'only backlog/' },
      { status: 'skipped', command: '', excerpt: '', exit: null, reason: 'only backlog/' },
    ]
  );
  assert.ok(!calls.some((c) => c.args.includes('test') || c.args.includes('test:properties')), 'a skipped check must never reach runFn');
  assert.ok(!raw.has('unit') && !raw.has('properties'), 'onRawOutcome must never fire for a skipped check');
  // every other check still ran, unaffected by the two skips.
  for (const row of rows) {
    if (row.id !== 'unit' && row.id !== 'properties') {
      assert.equal(row.status, 'ran');
    }
  }
});

test('composeQaGatherReport end to end: a real fixture repo whose parcel commit touches only backlog/ reports both lanes skipped', () => {
  const root = mkTmpDir('bl2024-backlog-only-');
  const { execFileSync } = require('node:child_process');
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-q']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  git(['branch', '-M', 'main']);
  // main itself stays at the init commit - the parcel commit is a
  // DESCENDANT on its own branch, never main's own tip, or merge-base
  // main <commit> would resolve to <commit> itself and the diff would be
  // empty (every path "outside" it vacuously, proving nothing).
  git(['checkout', '-q', '-b', 'parcel']);
  fs.mkdirSync(path.join(root, 'backlog', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'evidence', 'BL-9001-coder.md'), '# evidence\n');
  git(['add', '-A']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'add evidence']);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  const npmCalls = [];
  const runFn = (command, args, cwd) => {
    if (command === 'git') {
      return defaultRunFn(command, args, cwd);
    }
    if (command === 'npm') {
      npmCalls.push(args.join(' '));
    }
    return { started: true, exit: 0, stdout: '', stderr: '' };
  };
  const report = composeQaGatherReport(root, 'BL-9999', { commit }, runFn, undefined);
  const unitRow = report.checks.find((c) => c.id === 'unit');
  const propsRow = report.checks.find((c) => c.id === 'properties');
  assert.equal(unitRow.status, 'skipped');
  assert.equal(propsRow.status, 'skipped');
  assert.match(unitRow.reason, /backlog\/evidence\/BL-9001-coder\.md/);
  assert.deepEqual(npmCalls, []);
});

test('composeQaGatherReport end to end: a real fixture repo whose parcel commit touches a non-backlog path too runs both lanes', () => {
  const root = mkTmpDir('bl2024-mixed-');
  const { execFileSync } = require('node:child_process');
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-q']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  git(['branch', '-M', 'main']);
  // Same reasoning as the backlog-only test above: the parcel commit is a
  // descendant on its own branch, main stays behind.
  git(['checkout', '-q', '-b', 'parcel']);
  fs.mkdirSync(path.join(root, 'backlog', 'evidence'), { recursive: true });
  fs.mkdirSync(path.join(root, 'extension', 'src', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'evidence', 'BL-9001-coder.md'), '# evidence\n');
  fs.writeFileSync(path.join(root, 'extension', 'src', 'tools', 'bl9001.ts'), 'export const x = 1;\n');
  git(['add', '-A']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'add evidence and code']);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  const npmCalls = [];
  const runFn = (command, args, cwd) => {
    if (command === 'git') {
      return defaultRunFn(command, args, cwd);
    }
    if (command === 'npm') {
      npmCalls.push(args.join(' '));
      return { started: true, exit: 0, stdout: '', stderr: '' };
    }
    return { started: true, exit: 0, stdout: '', stderr: '' };
  };
  const report = composeQaGatherReport(root, 'BL-9999', { commit }, runFn, undefined);
  const unitRow = report.checks.find((c) => c.id === 'unit');
  const propsRow = report.checks.find((c) => c.id === 'properties');
  assert.equal(unitRow.status, 'ran');
  assert.equal(propsRow.status, 'ran');
  assert.deepEqual(npmCalls.sort(), ['run test:properties', 'test']);
});

// QA bounce D1 (2026-10-09): git's default rename detection collapses a
// moved file into ONE line naming only the destination, so a parcel that
// renames production code OUT of extension/src/ INTO backlog/ read as
// touching only backlog/ - invariant 1 failing open on exactly the diff
// shape it exists to catch. --no-renames (resolveChangedPaths's own fix)
// always lists both the old (D) and new (A) path. Real git, same
// end-to-end shape as the two tests above - never a restatement of the
// decision, and never a fake runFn standing in for git's own rename
// detection (the one thing no fake script can reproduce).
test('composeQaGatherReport end to end: a real fixture repo whose parcel commit RENAMES a file out of extension/src into backlog/ runs both lanes', () => {
  const root = mkTmpDir('bl2024-rename-');
  const { execFileSync } = require('node:child_process');
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-q']);
  fs.mkdirSync(path.join(root, 'extension', 'src', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, 'extension', 'src', 'tools', 'bl9001.ts'), 'export const x = 1;\n');
  git(['add', '-A']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed the source file']);
  git(['branch', '-M', 'main']);
  // Same reasoning as the two tests above: the parcel commit is a
  // descendant on its own branch, main stays behind.
  git(['checkout', '-q', '-b', 'parcel']);
  fs.mkdirSync(path.join(root, 'backlog'), { recursive: true });
  git(['mv', path.join('extension', 'src', 'tools', 'bl9001.ts'), path.join('backlog', 'bl9001.ts')]);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'rename into backlog/']);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  const npmCalls = [];
  const runFn = (command, args, cwd) => {
    if (command === 'git') {
      return defaultRunFn(command, args, cwd);
    }
    if (command === 'npm') {
      npmCalls.push(args.join(' '));
    }
    return { started: true, exit: 0, stdout: '', stderr: '' };
  };
  const report = composeQaGatherReport(root, 'BL-9999', { commit }, runFn, undefined);
  const unitRow = report.checks.find((c) => c.id === 'unit');
  const propsRow = report.checks.find((c) => c.id === 'properties');
  assert.equal(unitRow.status, 'ran', `expected unit to run (the rename must not read as backlog-only); got ${unitRow.status} (${unitRow.reason})`);
  assert.equal(propsRow.status, 'ran', `expected properties to run (the rename must not read as backlog-only); got ${propsRow.status} (${propsRow.reason})`);
  assert.deepEqual(npmCalls.sort(), ['run test:properties', 'test']);
});

// ── tailExcerpt ─────────────────────────────────────────────────────────

test('tailExcerpt returns short text unchanged and bounds long text to its own tail', () => {
  assert.equal(tailExcerpt('short'), 'short');
  const long = 'a'.repeat(5000) + 'TAIL';
  const bounded = tailExcerpt(long, 10);
  assert.equal(bounded.length, 10);
  assert.equal(bounded, long.slice(-10));
});

test('tailExcerpt: text exactly at maxChars is returned unchanged, not sliced', () => {
  const exact = 'x'.repeat(10);
  assert.equal(tailExcerpt(exact, 10), exact);
  assert.equal(tailExcerpt(exact, 10).length, 10);
});

// ── parseFailingFilesFromVitestOutput / failingFilesFromRow ─────────────

test('parseFailingFilesFromVitestOutput extracts every FAIL-line file, deduplicated', () => {
  const text = [
    ' FAIL  test/bl1364TurnProfileSeries.property.test.js > some assertion',
    ' FAIL  test/other.test.js > another',
    ' FAIL  test/bl1364TurnProfileSeries.property.test.js > a second failing case',
  ].join('\n');
  assert.deepEqual(parseFailingFilesFromVitestOutput(text), ['test/bl1364TurnProfileSeries.property.test.js', 'test/other.test.js']);
});

test('parseFailingFilesFromVitestOutput returns nothing for clean output', () => {
  assert.deepEqual(parseFailingFilesFromVitestOutput('Test Files  12 passed (12)\nTests  40 passed (40)'), []);
});

// rawMap: the raw-output-by-check-id map failingFilesFromRow/buildRegisterJoin
// now require (BL-1769) - built from the SAME text the old tests put in
// `excerpt`, since these fixtures are short enough that excerpt and the
// whole raw output are identical; the long-tail test below is the one that
// actually exercises the difference.
function rawMap(pairs) {
  return new Map(pairs);
}

test('failingFilesFromRow reads unit/properties rows via the vitest parser and acceptance rows by its own declared path on a non-zero exit', () => {
  const unitRow = { id: 'unit', status: 'ran', exit: 1, excerpt: ' FAIL  test/foo.test.js > x' };
  assert.deepEqual(failingFilesFromRow(unitRow, undefined, rawMap([['unit', unitRow.excerpt]])), ['extension/test/foo.test.js']);

  const cleanUnitRow = { id: 'unit', status: 'ran', exit: 0, excerpt: 'all good' };
  assert.deepEqual(failingFilesFromRow(cleanUnitRow, undefined, rawMap([['unit', cleanUnitRow.excerpt]])), []);

  const acceptanceRow = { id: 'acceptance', status: 'ran', exit: 1, excerpt: 'not ok 1 - a scenario' };
  assert.deepEqual(failingFilesFromRow(acceptanceRow, 'specs/features/BL-1-x.feature', rawMap([])), ['specs/features/BL-1-x.feature']);

  const passingAcceptanceRow = { id: 'acceptance', status: 'ran', exit: 0, excerpt: 'ok 1 - a scenario' };
  assert.deepEqual(failingFilesFromRow(passingAcceptanceRow, 'specs/features/BL-1-x.feature', rawMap([])), []);

  const blockedRow = { id: 'unit', status: 'blocked', exit: null, excerpt: '' };
  assert.deepEqual(failingFilesFromRow(blockedRow, undefined, rawMap([])), []);

  // A BLOCKED acceptance row specifically - the status!=='ran' guard is
  // the only thing standing between a never-run check and the acceptance
  // branch's own exit!==0 test, which a null exit also satisfies
  // (null !== 0). Without the guard this would wrongly report the
  // acceptance feature as failing when it never even ran.
  const blockedAcceptanceRow = { id: 'acceptance', status: 'blocked', exit: null, excerpt: '' };
  assert.deepEqual(failingFilesFromRow(blockedAcceptanceRow, 'specs/features/BL-1-x.feature', rawMap([])), []);
});

test('isFailingAcceptanceRow is false for every OTHER row id, even one over budget/nonzero exit', () => {
  const unitRow = { id: 'unit', status: 'ran', exit: 1, excerpt: '' };
  assert.deepEqual(failingFilesFromRow(unitRow, undefined, rawMap([])).length >= 0, true); // sanity: still parses via the unit branch, not acceptance
  const wiringRow = { id: 'wiring', status: 'ran', exit: 1, excerpt: '' };
  assert.deepEqual(failingFilesFromRow(wiringRow, 'specs/features/x.feature', rawMap([])), []);
});

// BL-1769: the whole point of the raw-output seam - a FAIL line that a
// BOUNDED excerpt would have sliced off is still found when the caller
// passes the real, unbounded output.
test('failingFilesFromRow finds a FAIL line the display excerpt would have cut off', () => {
  const failLine = ' FAIL  test/early.property.test.js > x\n';
  const noise = 'z'.repeat(EXCERPT_MAX_CHARS + 500);
  const wholeOutput = failLine + noise;
  const row = { id: 'properties', status: 'ran', exit: 1, excerpt: tailExcerpt(wholeOutput) };
  // The excerpt alone (what the pre-BL-1769 code parsed) no longer names the file.
  assert.deepEqual(parseFailingFilesFromVitestOutput(row.excerpt), []);
  // The raw, unbounded output still does.
  assert.deepEqual(
    failingFilesFromRow(row, undefined, rawMap([['properties', wholeOutput]])),
    ['extension/test/early.property.test.js']
  );
});

// ── buildRegisterJoin ────────────────────────────────────────────────────

test('buildRegisterJoin classifies owned/unowned/absent exactly per the register CLI\'s own owned field', () => {
  const excerpt = ' FAIL  extension/test/owned.property.test.js > x\n FAIL  extension/test/stale.property.test.js > y\n FAIL  extension/test/fresh.property.test.js > z';
  const rows = [{ id: 'properties', status: 'ran', exit: 1, excerpt }];
  const register = {
    rows: [
      { lane: 'property', file: 'extension/test/owned.property.test.js', ticket: 'BL-1553', first_seen: '2026-09-10', age_days: 6, owned: true },
      { lane: 'property', file: 'extension/test/stale.property.test.js', ticket: 'BL-1', first_seen: '2026-08-01', age_days: 46, owned: false },
    ],
  };
  const join = buildRegisterJoin(rows, register, undefined, rawMap([['properties', excerpt]]));
  assert.deepEqual(join, [
    { file: 'extension/test/fresh.property.test.js', join: 'absent' },
    { file: 'extension/test/owned.property.test.js', join: 'owned', ticket: 'BL-1553' },
    { file: 'extension/test/stale.property.test.js', join: 'unowned', ticket: 'BL-1' },
  ]);
});

test('buildRegisterJoin with no register data reports every failing file absent', () => {
  const excerpt = ' FAIL  test/foo.test.js > x';
  const rows = [{ id: 'unit', status: 'ran', exit: 1, excerpt }];
  assert.deepEqual(buildRegisterJoin(rows, undefined, undefined, rawMap([['unit', excerpt]])), [{ file: 'extension/test/foo.test.js', join: 'absent' }]);
});

// BL-1554 QA bounce D1: unit/properties rows run with cwd: extension/, so
// real vitest prints the FAIL line's file bare (test/...), never prefixed
// extension/test/... the way the register's own rows always are - the join
// must still match, for both lanes.
test('buildRegisterJoin matches a bare unit/properties vitest path against the register\'s extension/-relative row', () => {
  const unitExcerpt = ' FAIL  test/bl1277UnscopedStepCollisionGuard.test.js > x';
  const propsExcerpt = ' FAIL  test/bl968MaterializedGuardSensitivity.property.test.js > y';
  const rows = [
    { id: 'unit', status: 'ran', exit: 1, excerpt: unitExcerpt },
    { id: 'properties', status: 'ran', exit: 1, excerpt: propsExcerpt },
  ];
  const register = {
    rows: [
      { lane: 'unit', file: 'extension/test/bl1277UnscopedStepCollisionGuard.test.js', ticket: 'BL-1607', first_seen: '2026-09-10', age_days: 6, owned: true },
      { lane: 'property', file: 'extension/test/bl968MaterializedGuardSensitivity.property.test.js', ticket: 'BL-1606', first_seen: '2026-09-10', age_days: 6, owned: true },
    ],
  };
  const join = buildRegisterJoin(rows, register, undefined, rawMap([['unit', unitExcerpt], ['properties', propsExcerpt]]));
  assert.deepEqual(join, [
    { file: 'extension/test/bl1277UnscopedStepCollisionGuard.test.js', join: 'owned', ticket: 'BL-1607' },
    { file: 'extension/test/bl968MaterializedGuardSensitivity.property.test.js', join: 'owned', ticket: 'BL-1606' },
  ]);
});

// BL-1769 invariant: a red unit/properties row that names no failing file
// anywhere in its whole output contributes one `unidentified` entry keyed
// by the check id - never a silent empty join that reads as "no failing
// file" (BL-1726, BL-1766: both lost a real red to exactly this).
test('buildRegisterJoin reports unidentified for a red unit/properties row that names no failing file', () => {
  const noise = 'allowlisted BL-871 [vitest-worker]: Timeout calling "onTaskUpdate"\n'.repeat(20);
  const rows = [{ id: 'properties', status: 'ran', exit: 1, excerpt: tailExcerpt(noise) }];
  const join = buildRegisterJoin(rows, undefined, undefined, rawMap([['properties', noise]]));
  assert.deepEqual(join, [{ file: 'properties', join: 'unidentified' }]);
});

test('buildRegisterJoin never reports unidentified for a green row, a blocked row, or a named-failure row', () => {
  const greenRow = { id: 'unit', status: 'ran', exit: 0, excerpt: 'all good' };
  assert.deepEqual(buildRegisterJoin([greenRow], undefined, undefined, rawMap([['unit', 'all good']])), []);

  const blockedRow = { id: 'properties', status: 'blocked', exit: null, excerpt: '' };
  assert.deepEqual(buildRegisterJoin([blockedRow], undefined, undefined, rawMap([])), []);

  const namedExcerpt = ' FAIL  test/foo.test.js > x';
  const namedRow = { id: 'unit', status: 'ran', exit: 1, excerpt: namedExcerpt };
  assert.deepEqual(
    buildRegisterJoin([namedRow], undefined, undefined, rawMap([['unit', namedExcerpt]])),
    [{ file: 'extension/test/foo.test.js', join: 'absent' }]
  );
});

// BL-1769 hardener pass: isRedParseableRow ANDs four clauses
// (status/exit/exit/id), and every existing fixture above satisfies or
// fails several of them together (a blocked row has BOTH status!=='ran'
// AND exit===null; a green row has BOTH exit===0 and a unit/properties
// id) - none can discriminate any one clause from its sibling. Each case
// below isolates exactly one clause while holding the other three at the
// value that would otherwise report "unidentified".
test('buildRegisterJoin: isRedParseableRow single-clause isolation - a red row for a check outside unit/properties is never unidentified', () => {
  // Isolates the id clause: status 'ran', exit non-zero and non-null (both
  // "unidentified" values), but id 'register' - not a check this join can
  // ever attribute a failing file to.
  const registerRow = { id: 'register', status: 'ran', exit: 1, excerpt: 'register cli crashed' };
  assert.deepEqual(buildRegisterJoin([registerRow], undefined, undefined, rawMap([])), []);
});

test('buildRegisterJoin: isRedParseableRow single-clause isolation - a synthetic non-ran row with a numeric exit is never unidentified', () => {
  // Isolates the status clause from exit!==null: a status other than 'ran'
  // paired with a NON-null exit (unrealistic in production, but exactly
  // what discriminates status alone - every real 'blocked' row also has
  // exit===null, so it can never tell these two clauses apart).
  const blockedWithExit = { id: 'unit', status: 'blocked', exit: 1, excerpt: '' };
  assert.deepEqual(buildRegisterJoin([blockedWithExit], undefined, undefined, rawMap([])), []);
});

test('buildRegisterJoin: isRedParseableRow single-clause isolation - a synthetic ran row with a null exit is never unidentified', () => {
  // Isolates exit!==null itself: status==='ran' and id 'unit' both hold
  // (so a mutant removing status/id clauses stays masked by THIS case,
  // but that's fine - other cases above cover those), only exit is null.
  // The status-isolation case above cannot discriminate this clause: its
  // status!=='ran' already forces the whole `&&` chain false by
  // short-circuit, so a mutant on exit!==null is never even evaluated
  // there.
  const ranWithNullExit = { id: 'unit', status: 'ran', exit: null, excerpt: '' };
  assert.deepEqual(buildRegisterJoin([ranWithNullExit], undefined, undefined, rawMap([])), []);
});

test('buildRegisterJoin sorts unidentified entries, never leaving them in the rows\' own insertion order', () => {
  // "unit" is inserted before "properties" (the rows array below matches
  // CHECKLIST's own order) - alphabetical sort puts "properties" first,
  // discriminating .sort() from a no-op.
  const rows = [
    { id: 'unit', status: 'ran', exit: 1, excerpt: '' },
    { id: 'properties', status: 'ran', exit: 1, excerpt: '' },
  ];
  const join = buildRegisterJoin(rows, undefined, undefined, rawMap([['unit', 'no fail line here'], ['properties', 'no fail line here']]));
  assert.deepEqual(join, [
    { file: 'properties', join: 'unidentified' },
    { file: 'unit', join: 'unidentified' },
  ]);
});

test('buildRegisterJoin mixes a named failure and an unidentified check in the same report', () => {
  const unitExcerpt = ' FAIL  test/foo.test.js > x';
  const propsNoise = 'nothing named here, just noise\n';
  const rows = [
    { id: 'unit', status: 'ran', exit: 1, excerpt: unitExcerpt },
    { id: 'properties', status: 'ran', exit: 1, excerpt: tailExcerpt(propsNoise) },
  ];
  const join = buildRegisterJoin(rows, undefined, undefined, rawMap([['unit', unitExcerpt], ['properties', propsNoise]]));
  assert.deepEqual(join, [
    { file: 'extension/test/foo.test.js', join: 'absent' },
    { file: 'properties', join: 'unidentified' },
  ]);
});

// ── readAcceptancePath ───────────────────────────────────────────────────

test('readAcceptancePath reads a plain single-line scalar and rejects a block form', () => {
  assert.equal(readAcceptancePath('id: BL-1\nacceptance: specs/features/BL-1-x.feature\n'), 'specs/features/BL-1-x.feature');
  assert.equal(readAcceptancePath('id: BL-1\nacceptance: "specs/features/BL-1-x.feature"\n'), 'specs/features/BL-1-x.feature');
  assert.equal(readAcceptancePath('id: BL-1\nacceptance: |\n  given a thing\n'), undefined);
  assert.equal(readAcceptancePath('id: BL-1\nacceptance: >\n  folded text\n'), undefined);
  // A multi-character block indicator ("|-", the "strip trailing newlines"
  // form) where the marker sits only at the START of the value -
  // discriminates startsWith('|') from an endsWith('|') mutant, which a
  // single-character "|" value cannot (start and end coincide there).
  assert.equal(readAcceptancePath('id: BL-1\nacceptance: |-\n  text\n'), undefined);
  assert.equal(readAcceptancePath('id: BL-1\nacceptance: >-\n  text\n'), undefined);
  assert.equal(readAcceptancePath('id: BL-1\nstatus: todo\n'), undefined);
});

test('readAcceptancePath strips a single-quoted value too, and only the OUTER quote pair, never a quote mid-path', () => {
  assert.equal(readAcceptancePath("id: BL-1\nacceptance: 'specs/features/BL-1-x.feature'\n"), 'specs/features/BL-1-x.feature');
  // A quote character embedded in the middle of the value (not at either
  // edge) must survive untouched - discriminates the anchored regex
  // (^ / $) from an unanchored "strip any quote anywhere" mutant.
  assert.equal(readAcceptancePath('id: BL-1\nacceptance: specs/features/it"s-fine.feature\n'), 'specs/features/it"s-fine.feature');
});

// ── findTicketYamlContent: real fixture files ───────────────────────────

test('findTicketYamlContent finds a ticket by its own id: field across active/paused/done, nested by milestone', () => {
  const root = mkTmpDir('bl1554-');
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-1554-FIX-thing.yaml'), 'id: BL-1554-FIX\nacceptance: specs/features/one.feature\n');
  fs.mkdirSync(path.join(root, 'backlog', 'done', 'M8'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'done', 'M8', 'BL-9-shipped.yaml'), 'id: BL-9\nacceptance: specs/features/nine.feature\n');

  assert.equal(readAcceptancePath(findTicketYamlContent(root, 'BL-1554-FIX')), 'specs/features/one.feature');
  assert.equal(readAcceptancePath(findTicketYamlContent(root, 'BL-9')), 'specs/features/nine.feature');
  assert.equal(findTicketYamlContent(root, 'BL-9005'), undefined);
  // BL-992 invariant 3 shape: a filename PREFIX collision must not
  // resolve a lookup for a different id.
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-15540-other.yaml'), 'id: BL-15540\n');
  assert.equal(readAcceptancePath(findTicketYamlContent(root, 'BL-1554-FIX')), 'specs/features/one.feature');
});

test('findTicketYamlContent never reads a non-.yaml file, even one whose CONTENT would otherwise match the ticket id', () => {
  const root = mkTmpDir('bl1554-nonyaml-');
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  // "AAA..." sorts alphabetically before "BL-1554...", so a bypassed
  // endsWith('.yaml') guard would read THIS file first, find a matching
  // id: line, and return its WRONG acceptance path - a mismatched
  // extension alone (e.g. a binary file that never matches) would not
  // discriminate, since neither branch would report a match either way.
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'AAA-decoy.txt'), 'id: BL-1554-FIX\nacceptance: specs/features/WRONG.feature\n');
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-1554-FIX-thing.yaml'), 'id: BL-1554-FIX\nacceptance: specs/features/one.feature\n');

  assert.equal(readAcceptancePath(findTicketYamlContent(root, 'BL-1554-FIX')), 'specs/features/one.feature');
});

test('findTicketYamlContent finds the id: field even when it is not the file\'s first line, and skips a non-matching entry that sorts first', () => {
  const root = mkTmpDir('bl1554-notfirst-');
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  // "AAA..." sorts alphabetically before "BL-1554...", so a directory scan
  // that stopped at the first entry (rather than trying every one) would
  // return undefined here - and the target's own id: line sits BELOW a
  // comment and a title field, so a reader that trusted only the FIRST
  // line of the file would miss it too.
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'AAA-unrelated.yaml'), 'id: BL-1\ntitle: "unrelated"\n');
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-1554-FIX-thing.yaml'),
    '# a comment\ntitle: "the fix"\nid: BL-1554-FIX\nacceptance: specs/features/notfirst.feature\n'
  );

  assert.equal(readAcceptancePath(findTicketYamlContent(root, 'BL-1554-FIX')), 'specs/features/notfirst.feature');
});

// ── gatherQaChecklist end to end over a fake runner ─────────────────────

test('gatherQaChecklist resolves the ticket\'s own acceptance: path and reports it, never inventing a verdict', () => {
  const root = mkTmpDir('bl1554-');
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-1554-FIX-thing.yaml'), 'id: BL-1554-FIX\nacceptance: specs/features/one.feature\n');
  const { runFn } = fakeRunner({ default: { started: true, exit: 0, stdout: '{"rows":[]}', stderr: '' } });
  const report = gatherQaChecklist(root, 'BL-1554-FIX', { task: 'BL-1554-FIX', commit: 'abc1234567' }, runFn);
  assert.equal(report.ticket, 'BL-1554-FIX');
  assert.equal(report.checks.find((c) => c.id === 'acceptance').command.endsWith('specs/features/one.feature'), true);
  assert.deepEqual(report.register_join, []);
  for (const key of Object.keys(report)) {
    assert.ok(!/verdict|pass|bounce|approve/i.test(key), `report key "${key}" looks like a verdict field`);
  }
});

// BL-1554 architect bounce D1 (2026-09-16): the register check's raw JSON
// stdout was fed through the SAME bounding (tailExcerpt, EXCERPT_MAX_CHARS
// = 4000) as every other check's display excerpt, so a register large
// enough to cross that bound had its opening `{`/array structure sliced
// off, JSON.parse threw, and every failing file that run found silently
// reported `absent` regardless of what the register actually said -
// reproduces the architect's own repro (40 register rows, ~4640 chars).
test('composeQaGatherReport correctly classifies owned even when the register CLI\'s own JSON exceeds the display excerpt bound', () => {
  const bigRows = [];
  for (let i = 0; i < 40; i += 1) {
    bigRows.push({ lane: 'unit', file: `extension/test/file${i}.test.js`, ticket: `BL-${1000 + i}`, first_seen: '2026-01-01', age_days: 1, owned: true });
  }
  const registerJson = JSON.stringify({ rows: bigRows });
  assert.ok(registerJson.length > 4000, 'fixture must actually exceed the excerpt bound to reproduce D1');

  const runFn = (command, args) => {
    if (args.some((a) => String(a).includes('standing_red_register_cli'))) {
      return { started: true, exit: 0, stdout: registerJson, stderr: '' };
    }
    if (args.includes('test')) {
      return { started: true, exit: 1, stdout: 'FAIL test/file0.test.js\n', stderr: '' };
    }
    return { started: true, exit: 0, stdout: '', stderr: '' };
  };

  const report = composeQaGatherReport('/fake/root', 'BL-9999', { commit: 'abc1234567' }, runFn, undefined);

  assert.deepEqual(report.register_join, [{ file: 'extension/test/file0.test.js', join: 'owned', ticket: 'BL-1000' }]);
});

// onRawOutcome's own id-gated capture (`id === 'unit' || id === 'properties'`)
// is exercised above only via a RED 'unit' row - a mutant that breaks the
// capture specifically for 'properties' (e.g. `id === 'unit' || id !== 'properties'`,
// false for id === 'properties' itself) would still pass every test above.
test('composeQaGatherReport\'s raw-output capture also names a red PROPERTIES row\'s own failing file, not just a red unit row\'s', () => {
  const runFn = (command, args) => {
    if (args.includes('test:properties')) {
      return { started: true, exit: 1, stdout: 'FAIL test/bar.property.test.js\n', stderr: '' };
    }
    return { started: true, exit: 0, stdout: '', stderr: '' };
  };
  const report = composeQaGatherReport('/fake/root', 'BL-9999', { commit: 'abc1234567' }, runFn, undefined);
  assert.deepEqual(report.register_join, [{ file: 'extension/test/bar.property.test.js', join: 'absent' }]);
});

// ── defaultRunFn: real child_process (hardener pass, BL-1554) ──────────
// The default runFn is a thin spawnSync wrapper - never exercised with
// the REAL runner in the tests above (they all inject a fake), which is
// why it sat at 14% coverage / CRAP 14.08 despite low complexity. Real
// subprocess, no fixture.

test('defaultRunFn reports a successful command\'s real exit code, stdout and stderr', () => {
  const outcome = defaultRunFn('node', ['-e', 'console.log("out"); console.error("err"); process.exitCode = 0;'], process.cwd());
  assert.equal(outcome.started, true);
  assert.equal(outcome.exit, 0);
  assert.match(outcome.stdout, /out/);
  assert.match(outcome.stderr, /err/);
});

test('defaultRunFn reports a nonzero exit code as started with that exit, not a block', () => {
  const outcome = defaultRunFn('node', ['-e', 'process.exitCode = 3;'], process.cwd());
  assert.equal(outcome.started, true);
  assert.equal(outcome.exit, 3);
});

test('defaultRunFn reports started:false with the real error reason when the command cannot even spawn', () => {
  const outcome = defaultRunFn('this-binary-does-not-exist-bl1554', [], process.cwd());
  assert.equal(outcome.started, false);
  assert.equal(outcome.exit, null);
  assert.ok(outcome.reason && outcome.reason.length > 0, 'expected a real spawn error reason');
  assert.equal(outcome.stdout, '');
  assert.equal(outcome.stderr, '');
});

// ── parseRegisterOutput: every guard branch (hardener pass, BL-1554) ────

test('parseRegisterOutput returns undefined for an absent row, a blocked row, a null exit, or undefined raw stdout', () => {
  const okRow = { id: 'register', status: 'ran', exit: 0, command: '', cwd: '/r', duration_ms: 0, excerpt: '' };
  assert.equal(parseRegisterOutput(undefined, '{"rows":[]}'), undefined);
  assert.equal(parseRegisterOutput({ ...okRow, status: 'blocked' }, '{"rows":[]}'), undefined);
  assert.equal(parseRegisterOutput({ ...okRow, exit: null }, '{"rows":[]}'), undefined);
  assert.equal(parseRegisterOutput(okRow, undefined), undefined);
});

test('parseRegisterOutput parses real JSON and returns undefined (not throwing) on malformed JSON', () => {
  const okRow = { id: 'register', status: 'ran', exit: 0, command: '', cwd: '/r', duration_ms: 0, excerpt: '' };
  assert.deepEqual(parseRegisterOutput(okRow, '{"rows":[]}'), { rows: [] });
  assert.equal(parseRegisterOutput(okRow, 'not json{{{'), undefined);
});

// ── composeQaGatherReport: the register ROW lookup, not just its raw stdout ──

test('composeQaGatherReport gates the register join on the REGISTER check\'s own row (status/exit), never a different check\'s row', () => {
  // stragglers_before is the FIRST check in CHECKLIST - a mutant that
  // finds "the first check whose id is NOT register" instead of "the
  // check whose id IS register" would silently reach for stragglers_before's
  // row instead. Make that row BLOCKED (runner cannot start it) while the
  // register check genuinely succeeds - the two rows now disagree on
  // status, so grabbing the wrong one changes the outcome: register_join
  // must still classify the failing file, using the REGISTER row's own
  // (ran, exit 0) status, not stragglers_before's (blocked).
  const registerJson = JSON.stringify({ rows: [{ lane: 'unit', file: 'extension/test/file0.test.js', ticket: 'BL-1000', first_seen: '2026-01-01', age_days: 1, owned: true }] });
  const runFn = (command, args) => {
    if (args.some((a) => String(a).includes('pgrep')) || command === 'pgrep') {
      return { started: false, exit: null, stdout: '', stderr: '', reason: 'pgrep not found' };
    }
    if (args.some((a) => String(a).includes('standing_red_register_cli'))) {
      return { started: true, exit: 0, stdout: registerJson, stderr: '' };
    }
    if (args.includes('test')) {
      return { started: true, exit: 1, stdout: 'FAIL test/file0.test.js\n', stderr: '' };
    }
    return { started: true, exit: 0, stdout: '', stderr: '' };
  };

  const report = composeQaGatherReport('/fake/root', 'BL-9999', { commit: 'abc1234567' }, runFn, undefined);

  const stragglersBefore = report.checks.find((c) => c.id === 'stragglers_before');
  assert.equal(stragglersBefore.status, 'blocked', 'fixture setup: stragglers_before must actually be blocked');
  assert.deepEqual(report.register_join, [{ file: 'extension/test/file0.test.js', join: 'owned', ticket: 'BL-1000' }]);
});
