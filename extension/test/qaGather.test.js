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
} = require('../out/quality/qaGather');
const { findTicketYamlContent, gatherQaChecklist } = require('../out/metrics/qaGatherAdapter');

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
  assert.ok(row.duration_ms >= 0);
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
  assert.deepEqual(failingFilesFromRow(unitRow, undefined), ['test/foo.test.js']);

  const cleanUnitRow = { id: 'unit', status: 'ran', exit: 0, excerpt: 'all good' };
  assert.deepEqual(failingFilesFromRow(cleanUnitRow, undefined), []);

  const acceptanceRow = { id: 'acceptance', status: 'ran', exit: 1, excerpt: 'not ok 1 - a scenario' };
  assert.deepEqual(failingFilesFromRow(acceptanceRow, 'specs/features/BL-1-x.feature'), ['specs/features/BL-1-x.feature']);

  const passingAcceptanceRow = { id: 'acceptance', status: 'ran', exit: 0, excerpt: 'ok 1 - a scenario' };
  assert.deepEqual(failingFilesFromRow(passingAcceptanceRow, 'specs/features/BL-1-x.feature'), []);

  const blockedRow = { id: 'unit', status: 'blocked', exit: null, excerpt: '' };
  assert.deepEqual(failingFilesFromRow(blockedRow, undefined), []);
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
  assert.deepEqual(buildRegisterJoin(rows, undefined, undefined), [{ file: 'test/foo.test.js', join: 'absent' }]);
});

// ── readAcceptancePath ───────────────────────────────────────────────────

test('readAcceptancePath reads a plain single-line scalar and rejects a block form', () => {
  assert.equal(readAcceptancePath('id: BL-1\nacceptance: specs/features/BL-1-x.feature\n'), 'specs/features/BL-1-x.feature');
  assert.equal(readAcceptancePath('id: BL-1\nacceptance: "specs/features/BL-1-x.feature"\n'), 'specs/features/BL-1-x.feature');
  assert.equal(readAcceptancePath('id: BL-1\nacceptance: |\n  given a thing\n'), undefined);
  assert.equal(readAcceptancePath('id: BL-1\nstatus: todo\n'), undefined);
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
    bigRows.push({ lane: 'unit', file: `test/file${i}.test.js`, ticket: `BL-${1000 + i}`, first_seen: '2026-01-01', age_days: 1, owned: true });
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

  assert.deepEqual(report.register_join, [{ file: 'test/file0.test.js', join: 'owned', ticket: 'BL-1000' }]);
});
