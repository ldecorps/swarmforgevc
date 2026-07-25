'use strict';

// BL-575: step handlers for "swarm-cost-rank selects records by horizon
// against a pinned clock". Drives the REAL compiled swarm-cost-rank module
// (in-process, via its exported runSwarmCostRank/resolveNowMs seam) for the
// ranking/rollup scenarios, and the REAL compiled CLI as an actual
// subprocess for the scenario that specifically proves the clock seam
// reaches out-of-process (engineering.prompt's APS rule: never a
// hand-rolled reimplementation of the module under test).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const CLI = path.join(EXT_OUT, 'tools', 'swarm-cost-rank.js');
const NOW_MS_ENV_VAR = 'SWARMFORGE_COST_RANK_NOW_MS';

const { runSwarmCostRank } = require(path.join(EXT_OUT, 'tools', 'swarm-cost-rank'));
const { llmCostTelemetryDir } = require(path.join(EXT_OUT, 'metrics', 'llmCostLedgerStore'));

const FEATURE = 'swarm-cost-rank selects records by horizon against a pinned clock';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl575-cost-rank-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed roles.tsv']);
  return root;
}

function llmOrigin(overrides = {}) {
  return {
    subsystem: 'pipeline',
    role: 'coder',
    stage: 'coder',
    trigger: 'handoff',
    ticketId: 'BL-575',
    handoffId: 'h1',
    handoffType: 'git_handoff',
    script: null,
    pack: null,
    model: 'claude-sonnet-5',
    provider: 'claude',
    ...overrides,
  };
}

function writeLedger(root, records) {
  const dir = llmCostTelemetryDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'llm-cost-2026-07.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function ensureCtx(ctx) {
  if (!ctx.bl575) {
    ctx.bl575 = { records: [] };
  }
  return ctx.bl575;
}

function registerSteps(registry) {
  registry.defineScoped(/^the current time is pinned to "?([^"]+)"?$/, (ctx, isoInstant) => {
    const state = ensureCtx(ctx);
    state.nowIso = isoInstant;
    state.nowMs = Date.parse(isoInstant);
    if (Number.isNaN(state.nowMs)) {
      throw new Error(`expected a parseable pinned instant, got: "${isoInstant}"`);
    }
  }, FEATURE);

  registry.defineScoped(/^a ledger record timestamped "?([^"]+)"? costing ([\d.]+) USD$/, (ctx, atIso, costUsd) => {
    const state = ensureCtx(ctx);
    state.records.push({
      type: 'llm_invocation',
      at: atIso,
      model: 'claude-sonnet-5',
      tokens: null,
      costUsd: Number(costUsd),
      origin: llmOrigin(),
    });
  }, FEATURE);

  registry.defineScoped(/^a ledger record timestamped "?([^"]+)"? for role "?([^"]+)"?$/, (ctx, atIso, role) => {
    const state = ensureCtx(ctx);
    state.records.push({
      type: 'llm_invocation',
      at: atIso,
      model: 'claude-sonnet-5',
      tokens: null,
      costUsd: 1,
      origin: llmOrigin({ role }),
    });
  }, FEATURE);

  registry.defineScoped(/^swarm-cost-rank runs for horizon "?([^"]+)"?$/, (ctx, horizon) => {
    const state = ensureCtx(ctx);
    state.root = mkRepo();
    writeLedger(state.root, state.records);
    state.rankedResult = runSwarmCostRank({ horizon, topN: undefined, groupBy: [] }, state.root, state.nowMs);
  }, FEATURE);

  registry.defineScoped(/^swarm-cost-rank rolls up horizon "?([^"]+)"? by (\w+)$/, (ctx, horizon, dimension) => {
    const state = ensureCtx(ctx);
    state.root = mkRepo();
    writeLedger(state.root, state.records);
    state.groupsResult = runSwarmCostRank({ horizon, topN: undefined, groupBy: [dimension] }, state.root, state.nowMs);
  }, FEATURE);

  registry.defineScoped(/^the compiled CLI is run as a subprocess for horizon "?([^"]+)"?$/, (ctx, horizon) => {
    const state = ensureCtx(ctx);
    state.root = mkRepo();
    writeLedger(state.root, state.records);
    const output = execFileSync('node', [CLI, horizon], {
      cwd: state.root,
      encoding: 'utf8',
      env: { ...process.env, [NOW_MS_ENV_VAR]: String(state.nowMs) },
    });
    state.rankedResult = JSON.parse(output);
  }, FEATURE);

  registry.defineScoped(/^the ranked output holds (\d+) records?$/, (ctx, count) => {
    const state = ensureCtx(ctx);
    const actual = state.rankedResult.records.length;
    if (actual !== Number(count)) {
      throw new Error(`expected ${count} ranked record(s), got ${actual}: ${JSON.stringify(state.rankedResult)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the ranked output holds (\d+) groups?$/, (ctx, count) => {
    const state = ensureCtx(ctx);
    const actual = state.groupsResult.length;
    if (actual !== Number(count)) {
      throw new Error(`expected ${count} rollup group(s), got ${actual}: ${JSON.stringify(state.groupsResult)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the ranked costs are (.+)$/, (ctx, expectedCostsText) => {
    const state = ensureCtx(ctx);
    const expected = expectedCostsText.split(/\s+then\s+/).map(Number);
    const actual = state.rankedResult.records.map((r) => r.costUsd);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`expected ranked costs ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the reported total cost is ([\d.]+) USD$/, (ctx, expectedTotal) => {
    const state = ensureCtx(ctx);
    if (state.rankedResult.totalCostUsd !== Number(expectedTotal)) {
      throw new Error(`expected reported total cost ${expectedTotal}, got ${state.rankedResult.totalCostUsd}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
