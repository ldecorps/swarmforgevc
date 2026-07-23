const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, parseSwarmCostRankArgs } = require('../out/tools/swarm-cost-rank');
const { llmCostTelemetryDir } = require('../out/metrics/llmCostLedgerStore');

// BL-551: CLI over the unified LLM cost ledger - prints ranked/rolled-up JSON for a
// named horizon.

const CLI = path.join(__dirname, '..', 'out', 'tools', 'swarm-cost-rank.js');

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
  const root = mkTmpDir('sfvc-cost-rank-repo-');
  initRepo(root);
  writeRolesTsv(root);
  commitAll(root, 'seed roles.tsv');
  return root;
}

function origin(overrides = {}) {
  return {
    subsystem: 'pipeline',
    role: 'coder',
    stage: 'coder',
    trigger: 'handoff',
    ticketId: 'BL-551',
    handoffId: 'h1',
    handoffType: 'git_handoff',
    script: null,
    pack: 'openrouter-anthropic-mono-router',
    model: 'claude-sonnet-5',
    provider: 'claude',
    ...overrides,
  };
}

function invocation(overrides = {}) {
  return {
    type: 'llm_invocation',
    at: '2026-07-22T11:00:00Z',
    model: 'claude-sonnet-5',
    tokens: null,
    costUsd: 1,
    origin: origin(),
    ...overrides,
  };
}

function writeLedger(root, records) {
  const dir = llmCostTelemetryDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'llm-cost-2026-07.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// ── parseSwarmCostRankArgs ────────────────────────────────────────────────

test('parseSwarmCostRankArgs: rejects a missing horizon', () => {
  assert.equal(parseSwarmCostRankArgs([]), null);
});

test('parseSwarmCostRankArgs: rejects an unknown horizon', () => {
  assert.equal(parseSwarmCostRankArgs(['30m']), null);
});

test('parseSwarmCostRankArgs: accepts a bare known horizon with no topN/groupBy', () => {
  assert.deepEqual(parseSwarmCostRankArgs(['24h']), { horizon: '24h', topN: undefined, groupBy: [] });
});

test('parseSwarmCostRankArgs: rejects a non-positive topN', () => {
  assert.equal(parseSwarmCostRankArgs(['24h', '0']), null);
  assert.equal(parseSwarmCostRankArgs(['24h', '-1']), null);
  assert.equal(parseSwarmCostRankArgs(['24h', 'abc']), null);
});

test('parseSwarmCostRankArgs: parses topN and a groupBy dimension list, dropping unknown dimensions', () => {
  const args = parseSwarmCostRankArgs(['7d', '5', 'role,bogus,trigger']);
  assert.deepEqual(args, { horizon: '7d', topN: 5, groupBy: ['role', 'trigger'] });
});

// ── end-to-end main() ─────────────────────────────────────────────────────

async function runCliRaw(root, argv) {
  const originalCwd = process.cwd;
  const originalArgv = process.argv;
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.cwd = () => root;
    process.argv = ['node', 'swarm-cost-rank.js', ...argv];
    main();
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
    process.argv = originalArgv;
  }
  return writes.join('');
}

test('main: a bad horizon writes usage to stderr and sets exitCode 1, in-process', () => {
  const root = mkRepo();
  const originalCwd = process.cwd;
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const errWrites = [];
  const originalErrWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    errWrites.push(chunk);
    return true;
  };
  try {
    process.cwd = () => root;
    process.argv = ['node', 'swarm-cost-rank.js', '30m'];
    process.exitCode = undefined;
    main();
    assert.equal(process.exitCode, 1);
    assert.match(errWrites.join(''), /Usage: swarm-cost-rank\.js/);
  } finally {
    process.stderr.write = originalErrWrite;
    process.cwd = originalCwd;
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
  }
});

test('main: prints an empty ranked result when no ledger exists yet', async () => {
  const root = mkRepo();
  const output = await runCliRaw(root, ['24h']);
  const parsed = JSON.parse(output);
  assert.deepEqual(parsed.records, []);
  assert.equal(parsed.totalCostUsd, 0);
  assert.equal(parsed.unknownCostCount, 0);
});

test('main: ranks ledger records by cost descending for the requested horizon', async () => {
  const root = mkRepo();
  writeLedger(root, [invocation({ costUsd: 1 }), invocation({ costUsd: 5 })]);
  const output = await runCliRaw(root, ['24h']);
  const parsed = JSON.parse(output);
  assert.deepEqual(parsed.records.map((r) => r.costUsd), [5, 1]);
});

test('main: with a groupBy dimension, prints rollup groups instead of individual records', async () => {
  const root = mkRepo();
  writeLedger(root, [
    invocation({ costUsd: 1, origin: origin({ role: 'coder' }) }),
    invocation({ costUsd: 2, origin: origin({ role: 'coder' }) }),
    invocation({ costUsd: 10, origin: origin({ role: 'qa' }) }),
  ]);
  const output = await runCliRaw(root, ['24h', undefined, 'role']);
  const groups = JSON.parse(output);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].key, { role: 'qa' });
  assert.equal(groups[0].costUsd, 10);
});

test('the compiled CLI runs standalone as a subprocess and prints usage + exits 1 on a bad horizon', () => {
  const root = mkRepo();
  assert.throws(() => execFileSync('node', [CLI, '30m'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
});

test('the compiled CLI runs standalone as a subprocess and prints ranked JSON', () => {
  const root = mkRepo();
  writeLedger(root, [invocation({ costUsd: 4 })]);
  const output = execFileSync('node', [CLI, '24h'], { cwd: root, encoding: 'utf8' });
  const parsed = JSON.parse(output);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.totalCostUsd, 4);
});
