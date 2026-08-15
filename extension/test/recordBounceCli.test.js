const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, parseArgs } = require('../out/tools/record-bounce');
const { qaBouncesDir } = require('../out/metrics/qaBounceStore');
const { readBounceRecords, bouncesDir } = require('../out/metrics/bounceStore');
const { USAGE, resolveBounceInventory, resolveBlockedCount } = require('../out/tools/recordBounceArgs');

// BL-635: the generalised go-forward writer CLI - every reviewing role runs
// this at bounce time (not just QA). `--by` is REQUIRED, unlike the legacy
// record-qa-bounce.js CLI it generalises (recordQaBounceCli.test.js), which
// stays untouched and keeps its own optional-by contract.

const CLI = path.join(__dirname, '..', 'out', 'tools', 'record-bounce.js');

function mkTmp(prefix) {
  return mkTmpDir(prefix);
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepo(root) {
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
}

function writeRolesTsv(root) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
}

function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
}

function mkRepo() {
  const root = mkTmp('sfvc-record-bounce-repo-');
  initRepo(root);
  writeRolesTsv(root);
  commitAll(root, 'seed roles.tsv');
  return root;
}

function writeTicketYaml(root, ticket, extra = '') {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${ticket}-fixture.yaml`);
  fs.writeFileSync(file, `id: ${ticket}\ntitle: "fixture"\nstatus: active\n${extra}`);
  return file;
}

function flagArgs({
  ticket = 'BL-590',
  role = 'coder',
  type = 'defect',
  cls = 'behavior',
  commit = 'abc1234567',
  by = 'architect',
  evidence = 'backlog/evidence/BL-590-bounce-20260726.md',
  items = undefined,
  blocked = undefined,
} = {}) {
  const args = ['--ticket', ticket, '--role', role, '--type', type, '--class', cls, '--commit', commit];
  if (by !== undefined) {
    args.push('--by', by);
  }
  if (evidence !== undefined) {
    args.push('--evidence', evidence);
  }
  if (items !== undefined) {
    args.push('--items', items);
  }
  if (blocked !== undefined) {
    args.push('--blocked', String(blocked));
  }
  return args;
}

function inventoryJson(n) {
  return JSON.stringify(
    Array.from({ length: n }, (_, i) => ({ id: `D${i + 1}`, class: 'behavior', blamed: 'coder', pointer: `fixture.ts:${i + 1} fn()` }))
  );
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
    process.argv = ['node', CLI, ...args];
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
    process.argv = previousArgv;
  }
  return writes.length > 0 ? JSON.parse(writes.join('')) : null;
}

// ── parseArgs ──────────────────────────────────────────────────────────────

test('parseArgs accepts a fully valid invocation with the full role set', () => {
  assert.deepEqual(parseArgs(flagArgs()), {
    ticket: 'BL-590',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: 'abc1234567',
    by: 'architect',
    evidence: 'backlog/evidence/BL-590-bounce-20260726.md',
    inventory: { kind: 'none' },
    blocked: 0,
  });
});

for (const by of ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']) {
  test(`parseArgs accepts every known bouncing role, including ${by}`, () => {
    assert.equal(parseArgs(flagArgs({ by })).by, by);
  });
}

// BL-688: the two widened classes must parse identically to any other known
// class - no special-casing at the CLI layer, the vocabulary lives solely in
// qaBounce.ts's KNOWN_FAILURE_CLASSES.
for (const cls of ['invariant-unencoded', 'spec-gap']) {
  test(`parseArgs accepts the widened failure class ${cls}`, () => {
    assert.equal(parseArgs(flagArgs({ cls })).failureClass, cls);
  });
}

test('parseArgs rejects a failure class outside the widened set, e.g. "flaky"', () => {
  assert.equal(parseArgs(flagArgs({ cls: 'flaky' })), null);
});

test('parseArgs rejects a case variant of a valid widened class, e.g. "INVARIANT-UNENCODED"', () => {
  assert.equal(parseArgs(flagArgs({ cls: 'INVARIANT-UNENCODED' })), null);
});

// record-bounce-by-role-02: no --by at all fails loudly, writes nothing.

test('parseArgs rejects an invocation with no --by flag at all', () => {
  const args = ['--ticket', 'BL-590', '--role', 'coder', '--type', 'defect', '--class', 'behavior', '--commit', 'abc1234567'];
  assert.equal(parseArgs(args), null);
});

test('USAGE names the required --by flag', () => {
  assert.match(USAGE, /--by <bouncingRole>/);
  assert.match(USAGE, /required/);
});

test('USAGE opens with the CLI name and its required core flags', () => {
  assert.match(USAGE, /^Usage: record-bounce\.js --ticket <id> --role <producingRole> --type <ticketType> --class <failureClass>/);
});

test('USAGE documents the --role, --type, --class and --evidence field values', () => {
  assert.match(USAGE, /--role: coder\|cleaner\|architect\|hardender\|documenter/);
  assert.match(USAGE, /--type: feature\|bug\|defect\|chore\|docs\|enhancement\|epic/);
  assert.match(USAGE, /--class: compile\|unit\|integration\|acceptance\|behavior\|invariant-unencoded\|spec-gap/);
  assert.match(USAGE, /--evidence \(optional\): backlog\/evidence\/<file>\.md/);
});

// record-bounce-by-role-03: an unknown/misspelt bouncing role is rejected,
// naming the valid set (canonical spelling is "hardender", not "hardener").

test('parseArgs rejects the misspelt bouncing role "hardener"', () => {
  assert.equal(parseArgs(flagArgs({ by: 'hardener' })), null);
});

test('USAGE names the valid bouncing role set', () => {
  assert.match(USAGE, /specifier\|coder\|cleaner\|architect\|hardender\|documenter\|QA/);
});

test('parseArgs rejects a dangling --by flag with no following value', () => {
  const args = ['--ticket', 'BL-590', '--role', 'coder', '--type', 'defect', '--class', 'behavior', '--commit', 'abc1234567', '--by'];
  assert.equal(parseArgs(args), null);
});

test('parseArgs rejects an evidence path outside backlog/evidence/*.md', () => {
  assert.equal(parseArgs(flagArgs({ evidence: 'backlog/evidence/BL-590-bounce.txt' })), null);
});

test('parseArgs accepts --by with no --evidence - evidence alone stays optional', () => {
  const args = ['--ticket', 'BL-590', '--role', 'coder', '--type', 'defect', '--class', 'behavior', '--commit', 'abc1234567', '--by', 'architect'];
  assert.equal(parseArgs(args).by, 'architect');
  assert.equal(parseArgs(args).evidence, undefined);
});

test('parseArgs rejects a ticket id with no BL- prefix, same as the legacy CLI it generalises', () => {
  assert.equal(parseArgs(flagArgs({ ticket: '590' })), null);
});

// ── record-bounce-by-role-01: writes `by` to BOTH durable stores ──────────

test('recording a bounce writes `by` to the durable log AND the ticket record', async () => {
  const root = mkRepo();
  const ticketPath = writeTicketYaml(root, 'BL-590');
  const result = await runCli(root, flagArgs());
  assert.equal(result.recorded, true);

  const records = readBounceRecords(root);
  assert.equal(records.length, 1);
  assert.equal(records[0].by, 'architect');
  assert.equal(records[0].producingRole, 'coder');

  assert.equal(result.ticketRecordUpdated, true);
  const yamlText = fs.readFileSync(ticketPath, 'utf8');
  assert.match(yamlText, /bounce_count: 1/);
  assert.match(yamlText, /by: architect, blamed: coder/);
});

// ── record-bounce-by-role-07: new path only, legacy dir never written ─────

test('the record lands in the generalised bounces log; the legacy qa_bounces dir is never created', async () => {
  const root = mkRepo();
  const result = await runCli(root, flagArgs({ by: 'QA' }));
  assert.equal(result.recorded, true);
  assert.equal(fs.existsSync(path.join(bouncesDir(root), '2026-07.jsonl')) || fs.existsSync(bouncesDir(root)), true);
  assert.equal(fs.existsSync(qaBouncesDir(root)), false);
});

// ── record-bounce-by-role-04: four same-day bounces by architect on one
//    ticket, each a distinct commit, all land (bounce_count 4) ────────────

test('four architect bounces on one ticket, each a distinct commit, end with bounce_count 4', async () => {
  const root = mkRepo();
  const ticketPath = writeTicketYaml(root, 'BL-590');
  // The CLI stamps `at` from the real wall clock, so all four calls in this
  // test share the same calendar day - the ticket-YAML merge's own
  // idempotency key is date+failureClass (bounceHistory.ts, a locked BL-608
  // contract this ticket does not touch), so each bounce here also varies
  // failureClass to land as a genuinely distinct entry, same convention
  // recordQaBounceCli.test.js's bounce-history-on-ticket-03 already uses.
  const classes = ['behavior', 'compile', 'unit', 'integration'];
  for (let i = 0; i < classes.length; i++) {
    const commit = `commit000${i + 1}`;
    const result = await runCli(root, flagArgs({ commit, cls: classes[i], evidence: `backlog/evidence/BL-590-bounce-${commit}.md` }));
    assert.equal(result.recorded, true);
  }
  const records = readBounceRecords(root).filter((r) => r.ticket === 'BL-590');
  assert.equal(records.length, 4);
  assert.ok(records.every((r) => r.by === 'architect'));

  const yamlText = fs.readFileSync(ticketPath, 'utf8');
  assert.match(yamlText, /bounce_count: 4/);
  assert.equal((yamlText.match(/^ {2}- \{/gm) || []).length, 4);
});

// BL-688: the widened classes must actually record end to end, not merely
// parse - a class that parses but is dropped somewhere downstream would be
// just as silent a loss as today's rejection.
for (const cls of ['invariant-unencoded', 'spec-gap']) {
  test(`recording a bounce with the widened class ${cls} writes it to the durable log`, async () => {
    const root = mkRepo();
    const result = await runCli(root, flagArgs({ cls }));
    assert.equal(result.recorded, true);
    const records = readBounceRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0].failureClass, cls);
  });
}

test('recording a bounce with a failure class outside the widened set is a usage error that writes nothing', () => {
  const root = mkRepo();
  assert.throws(() => {
    execFileSync('node', [CLI, ...flagArgs({ cls: 'flaky' })], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }, /Command failed/);
  assert.equal(fs.existsSync(bouncesDir(root)), false);
});

test('recording the identical bounce twice does not double-count it', async () => {
  const root = mkRepo();
  await runCli(root, flagArgs());
  const second = await runCli(root, flagArgs());
  assert.equal(second.recorded, false);
  assert.equal(readBounceRecords(root).length, 1);
});

test('an unwritable ticket record does not block the bounce from being recorded', async () => {
  const root = mkRepo();
  const ticketPath = writeTicketYaml(root, 'BL-590');
  fs.rmSync(ticketPath, { force: true });
  fs.mkdirSync(ticketPath);
  const result = await runCli(root, flagArgs());
  assert.equal(result.recorded, true);
  assert.equal(readBounceRecords(root).length, 1);
  assert.equal(result.ticketRecordUpdated, false);
});

test('a missing ticket record is best-effort - the bounce is still recorded', async () => {
  const root = mkRepo();
  const result = await runCli(root, flagArgs());
  assert.equal(result.recorded, true);
  assert.equal(result.ticketRecordUpdated, false);
  assert.equal(result.ticketRecordReason, 'not-found');
});

// bounceHistory.ts's ticket-record entry format is date-only (yyyy-mm-dd) -
// the CLI must slice the full ISO timestamp down before merging it, never
// write the full timestamp (with its time-of-day and `T`) into the yaml.
test('the ticket bounce_history entry records a date-only `at`, never a full ISO timestamp', async () => {
  const root = mkRepo();
  const ticketPath = writeTicketYaml(root, 'BL-590');
  await runCli(root, flagArgs());
  const yamlText = fs.readFileSync(ticketPath, 'utf8');
  assert.match(yamlText, /- \{ at: \d{4}-\d{2}-\d{2}, by: architect/);
  assert.doesNotMatch(yamlText, /- \{ at: \d{4}-\d{2}-\d{2}T/);
});

test('omitting --evidence entirely skips the ticket-record merge without attempting it', async () => {
  const root = mkRepo();
  const ticketPath = writeTicketYaml(root, 'BL-590');
  const args = ['--ticket', 'BL-590', '--role', 'coder', '--type', 'defect', '--class', 'behavior', '--commit', 'abc1234567', '--by', 'architect'];
  const result = await runCli(root, args);
  assert.equal(result.recorded, true);
  assert.equal(result.ticketRecordUpdated, false);
  assert.equal(result.ticketRecordReason, 'not-attempted');
  assert.doesNotMatch(fs.readFileSync(ticketPath, 'utf8'), /bounce_count/);
});

test('the CLI prints usage and exits non-zero when invoked as a real subprocess with no --by', () => {
  const root = mkRepo();
  assert.throws(() => {
    execFileSync('node', [CLI, '--ticket', 'BL-590', '--role', 'coder', '--type', 'defect', '--class', 'behavior', '--commit', 'abc1234567'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }, /Command failed/);
});

// ── BL-689: resolveBounceInventory / resolveBlockedCount (pure) ────────────

test('resolveBounceInventory resolves "none" when --items is absent entirely', () => {
  assert.deepEqual(resolveBounceInventory(undefined), { kind: 'none' });
});

test('resolveBounceInventory degrades unparseable JSON to "unparseable"', () => {
  assert.deepEqual(resolveBounceInventory('{not json'), { kind: 'degraded', reason: 'unparseable' });
});

test('resolveBounceInventory degrades a non-array value to "invalid-item"', () => {
  assert.deepEqual(resolveBounceInventory('{"id":"D1"}'), { kind: 'degraded', reason: 'invalid-item' });
});

test('resolveBounceInventory degrades an empty array to "empty"', () => {
  assert.deepEqual(resolveBounceInventory('[]'), { kind: 'degraded', reason: 'empty' });
});

test('resolveBounceInventory degrades an item with an unknown class to "invalid-item"', () => {
  assert.deepEqual(resolveBounceInventory('[{"id":"D1","class":"flaky","blamed":"coder","pointer":"foo.ts:1 f()"}]'), {
    kind: 'degraded',
    reason: 'invalid-item',
  });
});

test('resolveBounceInventory degrades an item with an unknown blamed role to "invalid-item"', () => {
  assert.deepEqual(resolveBounceInventory('[{"id":"D1","class":"unit","blamed":"operator","pointer":"foo.ts:1 f()"}]'), {
    kind: 'degraded',
    reason: 'invalid-item',
  });
});

test('resolveBounceInventory resolves "ok" for a well-formed multi-item array', () => {
  const resolution = resolveBounceInventory(inventoryJson(2));
  assert.equal(resolution.kind, 'ok');
  assert.equal(resolution.items.length, 2);
});

test('resolveBlockedCount defaults to 0 when absent, negative, or non-integer', () => {
  assert.equal(resolveBlockedCount(undefined), 0);
  assert.equal(resolveBlockedCount('-1'), 0);
  assert.equal(resolveBlockedCount('1.5'), 0);
  assert.equal(resolveBlockedCount('not-a-number'), 0);
});

test('resolveBlockedCount parses a valid non-negative integer', () => {
  assert.equal(resolveBlockedCount('0'), 0);
  assert.equal(resolveBlockedCount('3'), 3);
});

// ── BL-689 parseArgs: --items/--blocked never gate the required-flag usage error ──

test('parseArgs still accepts a fully valid invocation with a well-formed inventory', () => {
  const args = parseArgs(flagArgs({ items: inventoryJson(2), blocked: 1 }));
  assert.equal(args.inventory.kind, 'ok');
  assert.equal(args.inventory.items.length, 2);
  assert.equal(args.blocked, 1);
});

test('parseArgs never returns null for a malformed --items - the required-field gate is unaffected', () => {
  const args = parseArgs(flagArgs({ items: '{not json' }));
  assert.notEqual(args, null);
  assert.deepEqual(args.inventory, { kind: 'degraded', reason: 'unparseable' });
});

test('parseArgs still rejects an invocation missing a required core flag, inventory notwithstanding', () => {
  const args = ['--role', 'coder', '--type', 'defect', '--class', 'behavior', '--commit', 'abc1234567', '--by', 'architect', '--items', inventoryJson(1)];
  assert.equal(parseArgs(args), null);
});

// ── BL-689 end to end: invariant 1, one bounce event, degrade path, exit zero ──

test('invariant 1: a call with no inventory writes the exact same record shape as before this ticket', async () => {
  const root = mkRepo();
  const before = await runCli(root, flagArgs({ commit: 'commit0aaa' }));
  const after = await runCli(root, flagArgs({ commit: 'commit0bbb' }));
  assert.equal(before.recorded, true);
  assert.equal(after.recorded, true);
  const records = readBounceRecords(root);
  assert.equal(records.length, 2);
  for (const r of records) {
    assert.equal('items' in r, false);
    assert.equal('blocked' in r, false);
  }
});

test('a well-formed inventory writes exactly one record carrying every item and the blocked count', async () => {
  const root = mkRepo();
  const result = await runCli(root, flagArgs({ items: inventoryJson(4), blocked: 3 }));
  assert.equal(result.recorded, true);
  assert.equal(result.inventoryDegradeReason, null);
  const records = readBounceRecords(root);
  assert.equal(records.length, 1);
  assert.equal(records[0].items.length, 4);
  assert.equal(records[0].blocked, 3);
  for (let i = 0; i < 4; i++) {
    assert.equal(records[0].items[i].id, `D${i + 1}`);
    assert.equal(typeof records[0].items[i].class, 'string');
    assert.equal(typeof records[0].items[i].blamed, 'string');
    assert.equal(typeof records[0].items[i].pointer, 'string');
  }
});

for (const [items, reason] of [
  ['{not json', 'unparseable'],
  ['[]', 'empty'],
  ['[{"id":"D1","class":"flaky","blamed":"coder","pointer":"foo.ts:1 f()"}]', 'invalid-item'],
  ['[{"id":"D1","class":"unit","blamed":"operator","pointer":"foo.ts:1 f()"}]', 'invalid-item'],
]) {
  test(`a rejected inventory (${reason}) never loses the bounce: single-item record written, reason reported, exit zero`, async () => {
    const root = mkRepo();
    const result = await runCli(root, flagArgs({ items }));
    assert.equal(result.recorded, true);
    assert.equal(result.inventoryDegradeReason, reason);
    const records = readBounceRecords(root);
    assert.equal(records.length, 1);
    assert.equal('items' in records[0], false);
    assert.equal('blocked' in records[0], false);
  });

  test(`the CLI subprocess exits zero for a rejected inventory (${reason})`, () => {
    const root = mkRepo();
    const out = execFileSync('node', [CLI, ...flagArgs({ items, commit: `sub${reason}` })], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const parsed = JSON.parse(out);
    assert.equal(parsed.recorded, true);
    assert.equal(parsed.inventoryDegradeReason, reason);
  });
}
