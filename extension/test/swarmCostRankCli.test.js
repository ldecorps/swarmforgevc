const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, parseSwarmCostRankArgs, resolveNowMs } = require('../out/tools/swarm-cost-rank');
const { llmCostTelemetryDir } = require('../out/metrics/llmCostLedgerStore');

// BL-551: CLI over the unified LLM cost ledger - prints ranked/rolled-up JSON for a
// named horizon.
//
// BL-575: the horizon window is computed from `Date.now()` in production, so a
// fixture built from a hardcoded absolute instant silently ages out of the 24h
// window and starts failing on a later calendar day with no code change at all
// (the real-clock fixture flake pattern). Every scenario below instead pins
// BOTH the fixture and the code under test to the same fixed reference instant
// via the `SWARMFORGE_COST_RANK_NOW_MS` env seam (`resolveNowMs`), so the same
// run gives the same answer on any calendar day.

const CLI = path.join(__dirname, '..', 'out', 'tools', 'swarm-cost-rank.js');
const NOW_MS_ENV_VAR = 'SWARMFORGE_COST_RANK_NOW_MS';
const PINNED_NOW_ISO = '2026-07-22T12:00:00Z';
const PINNED_NOW_MS = Date.parse(PINNED_NOW_ISO);

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
    // Relative to the PINNED reference instant (1h before it, so it always
    // falls inside every named horizon), never a bare hardcoded date and
    // never the real Date.now() - see the pinned-clock note above.
    at: new Date(PINNED_NOW_MS - 60 * 60 * 1000).toISOString(),
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

// ── resolveNowMs (the clock seam itself) ───────────────────────────────────

test('resolveNowMs: with no override set, returns the real current time', () => {
  const original = process.env[NOW_MS_ENV_VAR];
  delete process.env[NOW_MS_ENV_VAR];
  try {
    const before = Date.now();
    const resolved = resolveNowMs();
    const after = Date.now();
    assert.ok(resolved >= before && resolved <= after, `expected resolveNowMs() in [${before}, ${after}], got ${resolved}`);
  } finally {
    if (original === undefined) {
      delete process.env[NOW_MS_ENV_VAR];
    } else {
      process.env[NOW_MS_ENV_VAR] = original;
    }
  }
});

test('resolveNowMs: an override is parsed and returned exactly, never Date.now()', () => {
  assert.equal(resolveNowMs({ [NOW_MS_ENV_VAR]: String(PINNED_NOW_MS) }), PINNED_NOW_MS);
});

test('resolveNowMs: a non-numeric override falls back to the real current time', () => {
  const before = Date.now();
  const resolved = resolveNowMs({ [NOW_MS_ENV_VAR]: 'not-a-number' });
  const after = Date.now();
  assert.ok(resolved >= before && resolved <= after, `expected fallback to real time, got ${resolved}`);
});

// ── end-to-end main() ─────────────────────────────────────────────────────

async function runCliRaw(root, argv, { nowMs = PINNED_NOW_MS } = {}) {
  const originalCwd = process.cwd;
  const originalArgv = process.argv;
  const originalNowOverride = process.env[NOW_MS_ENV_VAR];
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.cwd = () => root;
    process.argv = ['node', 'swarm-cost-rank.js', ...argv];
    if (nowMs === undefined) {
      delete process.env[NOW_MS_ENV_VAR];
    } else {
      process.env[NOW_MS_ENV_VAR] = String(nowMs);
    }
    main();
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
    process.argv = originalArgv;
    if (originalNowOverride === undefined) {
      delete process.env[NOW_MS_ENV_VAR];
    } else {
      process.env[NOW_MS_ENV_VAR] = originalNowOverride;
    }
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

test('main: a record outside the pinned 24h window is excluded (non-vacuity: the horizon filter is proven, not a no-op)', async () => {
  const root = mkRepo();
  writeLedger(root, [
    invocation({ costUsd: 1 }), // 1h before pinned now: inside 24h
    invocation({ costUsd: 9, at: new Date(PINNED_NOW_MS - 2 * 24 * 60 * 60 * 1000).toISOString() }), // 2d before: outside 24h
  ]);
  const output = await runCliRaw(root, ['24h']);
  const parsed = JSON.parse(output);
  assert.equal(parsed.records.length, 1, `expected only the in-window record, got: ${output}`);
  assert.equal(parsed.totalCostUsd, 1);
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

// BL-575 scenario-04: the seam must be reachable out-of-process too, so the
// override travels through the subprocess's own env rather than in-process
// state - proves the fixture-and-code pinning holds for the real compiled
// entry point, not just for `main()` called in-process.
test('the compiled CLI honours a pinned clock passed via env when run as a subprocess', () => {
  const root = mkRepo();
  writeLedger(root, [invocation({ costUsd: 4 })]);
  const output = execFileSync('node', [CLI, '24h'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, [NOW_MS_ENV_VAR]: String(PINNED_NOW_MS) },
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.totalCostUsd, 4);
});

// Production-unchanged proof: with NO override in the subprocess env, the
// CLI must still filter against the true current time - a record built
// relative to the REAL clock (not the pinned fixture instant) must still
// rank.
test('the compiled CLI still filters against the true current time when no override is set', () => {
  const root = mkRepo();
  writeLedger(root, [invocation({ costUsd: 4, at: new Date(Date.now() - 60 * 60 * 1000).toISOString() })]);
  const env = { ...process.env };
  delete env[NOW_MS_ENV_VAR];
  const output = execFileSync('node', [CLI, '24h'], { cwd: root, encoding: 'utf8', env });
  const parsed = JSON.parse(output);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.totalCostUsd, 4);
});
