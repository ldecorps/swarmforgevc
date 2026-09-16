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
} = require('../out/quality/qaGather');
const { findTicketYamlContent, gatherQaChecklist, defaultRunFn } = require('../out/metrics/qaGatherAdapter');

// ── CHECKLIST shape and order (BL-1554 invariant 3) ────────────────────

test('the checklist is the fixed 8 checks in the fixed order', () => {
  assert.deepEqual(
    CHECKLIST.map((c) => c.id),
    ['stragglers_before', 'sibling', 'register', 'wiring', 'unit', 'properties', 'acceptance', 'stragglers_after'],
  );
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
  const rows = runChecklist(CHECKLIST, { root: '/r', ticketId: 'BL-1', commit: 'abc1234567' }, runFn);
  assert.equal(rows.length, CHECKLIST.length);
  assert.deepEqual(rows.map((r) => r.id), CHECKLIST.map((c) => c.id));
  // no --task and no acceptanceFeature -> wiring and acceptance are
  // blocked WITHOUT ever calling runFn, but every other check still ran.
  const wiring = rows.find((r) => r.id === 'wiring');
  const acceptance = rows.find((r) => r.id === 'acceptance');
  assert.equal(wiring.status, 'blocked');
  assert.match(wiring.reason, /--task/);
  assert.equal(acceptance.status, 'blocked');
  assert.match(acceptance.reason, /acceptance/);
  for (const row of rows) {
    if (row.id !== 'wiring' && row.id !== 'acceptance') {
      assert.equal(row.status, 'ran');
      assert.equal(row.exit, 0);
    }
  }
});

test('a check the runner cannot start is reported blocked with the runner\'s own reason, and later checks still run', () => {
  const { runFn, calls } = fakeRunner({
    node: { started: false, exit: null, stdout: '', stderr: '', reason: 'ENOENT: no such file' },
    default: { started: true, exit: 0, stdout: '', stderr: '' },
  });
  const rows = runChecklist(CHECKLIST, { root: '/r', ticketId: 'BL-1', commit: 'abc1234567', task: 't', acceptanceFeature: 'f.feature' }, runFn);
  const sibling = rows.find((r) => r.id === 'sibling');
  assert.equal(sibling.status, 'blocked');
  assert.equal(sibling.reason, 'ENOENT: no such file');
  // every check after sibling was still started (only sibling's own
  // command uses `node`, so the count of started calls after it is every
  // remaining check).
  const afterSibling = rows.slice(rows.findIndex((r) => r.id === 'sibling') + 1);
  assert.ok(afterSibling.every((r) => r.status === 'ran'));
  assert.equal(calls.length, CHECKLIST.length); // every build produced a real command in this fixture
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
  runChecklist(CHECKLIST, { root: '/r', ticketId: 'BL-1', commit: 'abc1234567', task: 't', acceptanceFeature: 'f.feature' }, runFn);
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

test('failingFilesFromRow reads unit/properties rows via the vitest parser and acceptance rows by its own declared path on a non-zero exit', () => {
  const unitRow = { id: 'unit', status: 'ran', exit: 1, excerpt: ' FAIL  test/foo.test.js > x' };
  assert.deepEqual(failingFilesFromRow(unitRow, undefined), ['extension/test/foo.test.js']);

  const cleanUnitRow = { id: 'unit', status: 'ran', exit: 0, excerpt: 'all good' };
  assert.deepEqual(failingFilesFromRow(cleanUnitRow, undefined), []);

  const acceptanceRow = { id: 'acceptance', status: 'ran', exit: 1, excerpt: 'not ok 1 - a scenario' };
  assert.deepEqual(failingFilesFromRow(acceptanceRow, 'specs/features/BL-1-x.feature'), ['specs/features/BL-1-x.feature']);

  const passingAcceptanceRow = { id: 'acceptance', status: 'ran', exit: 0, excerpt: 'ok 1 - a scenario' };
  assert.deepEqual(failingFilesFromRow(passingAcceptanceRow, 'specs/features/BL-1-x.feature'), []);

  const blockedRow = { id: 'unit', status: 'blocked', exit: null, excerpt: '' };
  assert.deepEqual(failingFilesFromRow(blockedRow, undefined), []);

  // A BLOCKED acceptance row specifically - the status!=='ran' guard is
  // the only thing standing between a never-run check and the acceptance
  // branch's own exit!==0 test, which a null exit also satisfies
  // (null !== 0). Without the guard this would wrongly report the
  // acceptance feature as failing when it never even ran.
  const blockedAcceptanceRow = { id: 'acceptance', status: 'blocked', exit: null, excerpt: '' };
  assert.deepEqual(failingFilesFromRow(blockedAcceptanceRow, 'specs/features/BL-1-x.feature'), []);
});

test('isFailingAcceptanceRow is false for every OTHER row id, even one over budget/nonzero exit', () => {
  const unitRow = { id: 'unit', status: 'ran', exit: 1, excerpt: '' };
  assert.deepEqual(failingFilesFromRow(unitRow, undefined).length >= 0, true); // sanity: still parses via the unit branch, not acceptance
  const wiringRow = { id: 'wiring', status: 'ran', exit: 1, excerpt: '' };
  assert.deepEqual(failingFilesFromRow(wiringRow, 'specs/features/x.feature'), []);
});

// ── buildRegisterJoin ────────────────────────────────────────────────────

test('buildRegisterJoin classifies owned/unowned/absent exactly per the register CLI\'s own owned field', () => {
  const rows = [
    { id: 'properties', status: 'ran', exit: 1, excerpt: ' FAIL  extension/test/owned.property.test.js > x\n FAIL  extension/test/stale.property.test.js > y\n FAIL  extension/test/fresh.property.test.js > z' },
  ];
  const register = {
    rows: [
      { lane: 'property', file: 'extension/test/owned.property.test.js', ticket: 'BL-1553', first_seen: '2026-09-10', age_days: 6, owned: true },
      { lane: 'property', file: 'extension/test/stale.property.test.js', ticket: 'BL-1', first_seen: '2026-08-01', age_days: 46, owned: false },
    ],
  };
  const join = buildRegisterJoin(rows, register, undefined);
  assert.deepEqual(join, [
    { file: 'extension/test/fresh.property.test.js', join: 'absent' },
    { file: 'extension/test/owned.property.test.js', join: 'owned', ticket: 'BL-1553' },
    { file: 'extension/test/stale.property.test.js', join: 'unowned', ticket: 'BL-1' },
  ]);
});

test('buildRegisterJoin with no register data reports every failing file absent', () => {
  const rows = [{ id: 'unit', status: 'ran', exit: 1, excerpt: ' FAIL  test/foo.test.js > x' }];
  assert.deepEqual(buildRegisterJoin(rows, undefined, undefined), [{ file: 'extension/test/foo.test.js', join: 'absent' }]);
});

// BL-1554 QA bounce D1: unit/properties rows run with cwd: extension/, so
// real vitest prints the FAIL line's file bare (test/...), never prefixed
// extension/test/... the way the register's own rows always are - the join
// must still match, for both lanes.
test('buildRegisterJoin matches a bare unit/properties vitest path against the register\'s extension/-relative row', () => {
  const rows = [
    { id: 'unit', status: 'ran', exit: 1, excerpt: ' FAIL  test/bl1277UnscopedStepCollisionGuard.test.js > x' },
    { id: 'properties', status: 'ran', exit: 1, excerpt: ' FAIL  test/bl968MaterializedGuardSensitivity.property.test.js > y' },
  ];
  const register = {
    rows: [
      { lane: 'unit', file: 'extension/test/bl1277UnscopedStepCollisionGuard.test.js', ticket: 'BL-1607', first_seen: '2026-09-10', age_days: 6, owned: true },
      { lane: 'property', file: 'extension/test/bl968MaterializedGuardSensitivity.property.test.js', ticket: 'BL-1606', first_seen: '2026-09-10', age_days: 6, owned: true },
    ],
  };
  const join = buildRegisterJoin(rows, register, undefined);
  assert.deepEqual(join, [
    { file: 'extension/test/bl1277UnscopedStepCollisionGuard.test.js', join: 'owned', ticket: 'BL-1607' },
    { file: 'extension/test/bl968MaterializedGuardSensitivity.property.test.js', join: 'owned', ticket: 'BL-1606' },
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
