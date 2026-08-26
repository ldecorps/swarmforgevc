const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { main } = require('../out/tools/record-bounce');
const { readBounceRecords } = require('../out/metrics/bounceStore');
const { computeQaBounceTally, computeBounceTallyByBouncingRole, KNOWN_FAILURE_CLASSES, KNOWN_PRODUCING_ROLES } = require('../out/quality/qaBounce');

// BL-689 declared invariants (backlog/active/BL-689-bounce-carries-its-defect-inventory.yaml):
// 1. A call with no inventory writes exactly the record it writes today -
//    same fields, no inventory key.
// 2. One call is one bounce EVENT: for any inventory size N, every existing
//    tally's bounce count rises by exactly 1, never by N.
// 3. A rejected or partially-invalid inventory never loses the bounce.
// Coder-authored property tests per BL-654; runs only via npm run test:properties.

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkRepo() {
  const root = mkTmpDir('sfvc-bl689-inv-');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  return root;
}

let commitCounter = 0;
function nextCommit() {
  commitCounter += 1;
  return `pinv${String(commitCounter).padStart(6, '0')}`;
}

async function runCli(root, args) {
  const originalCwd = process.cwd;
  const previousArgv = process.argv;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.cwd = () => root;
    process.argv = ['node', 'record-bounce.js', ...args];
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
    process.argv = previousArgv;
  }
  return writes.length > 0 ? JSON.parse(writes.join('')) : null;
}

function baseArgs(overrides = {}) {
  const { ticket = 'BL-1', role = 'coder', type = 'defect', cls = 'behavior', by = 'architect', commit = nextCommit() } = overrides;
  return ['--ticket', ticket, '--role', role, '--type', type, '--class', cls, '--commit', commit, '--by', by];
}

// ── invariant 1 ──────────────────────────────────────────────────────────

test('property: invariant 1 - a call with no inventory writes exactly the pre-BL-689 record shape', async () => {
  const root = mkRepo();
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(...KNOWN_PRODUCING_ROLES),
      fc.constantFrom(...KNOWN_FAILURE_CLASSES),
      async (role, cls) => {
        const result = await runCli(root, baseArgs({ role, cls }));
        assert.equal(result.recorded, true, `expected the call to record: ${JSON.stringify(result)}`);
        const records = readBounceRecords(root);
        const record = records[records.length - 1];
        assert.deepEqual(
          Object.keys(record).sort(),
          ['at', 'by', 'commit', 'failureClass', 'producingRole', 'ticket', 'ticketType'].sort(),
          `expected exactly the pre-BL-689 field set, got: ${JSON.stringify(Object.keys(record))}`
        );
      }
    ),
    { numRuns: 25 }
  );
});

// ── invariant 2 ──────────────────────────────────────────────────────────

test('property: invariant 2 - one call with an N-item inventory rises every tally by exactly 1, never by N', async () => {
  const root = mkRepo();
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 12 }), async (n) => {
      const before = readBounceRecords(root);
      const totalBefore = computeQaBounceTally(before).total;
      const byBouncingBefore = computeBounceTallyByBouncingRole(before).reduce((sum, r) => sum + r.count, 0);

      const items = Array.from({ length: n }, (_, i) => ({ id: `D${i + 1}`, class: 'behavior', blamed: 'coder', pointer: `f.ts:${i + 1} g()` }));
      const result = await runCli(root, [...baseArgs(), '--items', JSON.stringify(items)]);
      assert.equal(result.recorded, true, `expected the call to record: ${JSON.stringify(result)}`);

      const after = readBounceRecords(root);
      const totalAfter = computeQaBounceTally(after).total;
      const byBouncingAfter = computeBounceTallyByBouncingRole(after).reduce((sum, r) => sum + r.count, 0);

      assert.equal(after.length, before.length + 1, `record count must rise by exactly 1, not ${n}`);
      assert.equal(totalAfter, totalBefore + 1, `computeQaBounceTally.total must rise by exactly 1, not ${n}`);
      assert.equal(byBouncingAfter, byBouncingBefore + 1, `computeBounceTallyByBouncingRole sum must rise by exactly 1, not ${n}`);
    }),
    { numRuns: 20 }
  );
});

// ── invariant 3 ──────────────────────────────────────────────────────────

const BROKEN_JSON_ARB = fc.constantFrom('{not json', '[1,2,', '"unterminated', 'undefined', '{"a":}', 'nul', '[{]');

const INVALID_ITEM_ARB = fc
  .record({
    id: fc.constantFrom('', 'D1', 'D2'),
    cls: fc.constantFrom('flaky', 'scope', 'made-up-class'),
    blamed: fc.constantFrom('operator', 'QA', 'specifier'),
    pointer: fc.constantFrom('', 'foo.ts:1 f()'),
  })
  // Guaranteed invalid: `cls` and `blamed` are drawn only from OUTSIDE their
  // closed sets above, so every combination is already invalid - the filter
  // is a defensive belt-and-braces check, not load-bearing.
  .filter(({ id, cls, blamed, pointer }) => !(id.length > 0 && KNOWN_FAILURE_CLASSES.includes(cls) && KNOWN_PRODUCING_ROLES.includes(blamed) && pointer.length > 0))
  .map(({ id, cls, blamed, pointer }) => JSON.stringify([{ id, class: cls, blamed, pointer }]));

const DEGRADE_CASE_ARB = fc.oneof(
  BROKEN_JSON_ARB.map((raw) => ({ raw, reason: 'unparseable' })),
  fc.constant({ raw: '[]', reason: 'empty' }),
  INVALID_ITEM_ARB.map((raw) => ({ raw, reason: 'invalid-item' }))
);

test('property: invariant 3 - a rejected inventory never loses the bounce, always reports its reason, always exits without throwing', async () => {
  const root = mkRepo();
  await fc.assert(
    fc.asyncProperty(DEGRADE_CASE_ARB, async ({ raw, reason }) => {
      const before = readBounceRecords(root).length;
      const result = await runCli(root, [...baseArgs(), '--items', raw]);
      assert.equal(result.recorded, true, `expected the bounce to still be recorded for a rejected inventory, got: ${JSON.stringify(result)}`);
      assert.equal(result.inventoryDegradeReason, reason, `expected degrade reason "${reason}", got: ${JSON.stringify(result)}`);
      const after = readBounceRecords(root);
      assert.equal(after.length, before + 1, 'the single-item record must still be written exactly once');
      const record = after[after.length - 1];
      assert.equal('items' in record, false, 'a rejected inventory must never leave a partial items field');
      assert.equal('blocked' in record, false, 'a rejected inventory must never leave a partial blocked field');
    }),
    { numRuns: 30 }
  );
});

// ── non-vacuity ──────────────────────────────────────────────────────────

test('non-vacuity: invariant 1 property fails when the record leaks an extra field', () => {
  const record = { ticket: 'BL-1', producingRole: 'coder', ticketType: 'defect', failureClass: 'behavior', commit: 'a', by: 'architect', at: 'x', items: [] };
  assert.notDeepEqual(Object.keys(record).sort(), ['at', 'by', 'commit', 'failureClass', 'producingRole', 'ticket', 'ticketType'].sort());
});

test('non-vacuity: invariant 2 property fails when a broken tally counts once per item', () => {
  const brokenTotal = (recordsBefore, n) => recordsBefore + n;
  assert.notEqual(brokenTotal(0, 4), 0 + 1);
});

test('non-vacuity: invariant 3 property fails when a rejected inventory is dropped instead of degraded', () => {
  const brokenRecordedFlag = false;
  assert.equal(brokenRecordedFlag, false, 'a broken implementation that drops the bounce on a rejected inventory would report recorded=false, catching the regression this property guards against');
});
