'use strict';

// BL-551: step handlers for "LLM invocation cost ledger ranks expensive
// calls by origin over 3h, 24h, and 7d". Drives the REAL compiled read side
// (llmCostLedger.js/llmCostLedgerStore.js), the REAL compiled bridge server
// (/cost-rank) and cost health sidecar, and the two dedicated bb-fixture
// acceptance runners for the writer scenarios (handoffd.bb's deliver! and
// operator_runtime.bb's front-desk reap) - never a hand-rolled
// reimplementation of any of these (engineering.prompt's APS rule).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');

const {
  LLM_COST_HORIZONS_MS,
  rankLlmInvocations,
  rollupLlmInvocationsByOrigin,
} = require(path.join(EXT_OUT, 'metrics', 'llmCostLedger'));
const { llmCostTelemetryDir } = require(path.join(EXT_OUT, 'metrics', 'llmCostLedgerStore'));
const { startBridge } = require(path.join(EXT_OUT, 'bridge', 'bridgeServer'));
const { computeCostHealthSidecar, renderCostHealthSection } = require(path.join(EXT_OUT, 'notify', 'costHealthSidecar'));

const HANDOFF_DELIVERY_RUNNER = path.join(SCRIPTS_DIR, 'bl551_handoff_delivery_llm_cost_ledger_acceptance_runner.sh');
const REAP_RUNNER = path.join(SCRIPTS_DIR, 'bl551_reap_llm_cost_ledger_acceptance_runner.sh');

const BRIDGE_TOKEN = 'bl551-acceptance-token';

// BL-425 scoping convention: every registration below is pinned to this
// exact Feature: title so an unscoped step-text collision in another
// feature's step file (e.g. BL-511's identical "the invocation is reaped")
// can never win resolution for this feature's scenarios.
const FEATURE = 'LLM invocation cost ledger ranks expensive calls by origin over 3h, 24h, and 7d';

// engineering.prompt Scenario Outline rule: Examples values are validated
// against an explicit lookup, never a bare passthrough.
const KNOWN_HORIZONS = new Set(['3h', '24h', '7d']);

const ORIGIN_FIELDS = ['subsystem', 'role', 'stage', 'trigger', 'ticketId', 'handoffId', 'handoffType', 'script', 'pack', 'model', 'provider'];

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function llmOrigin(overrides = {}) {
  return {
    subsystem: 'pipeline',
    role: 'coder',
    stage: 'coder',
    trigger: 'handoff',
    ticketId: 'BL-551',
    handoffId: 'h1',
    handoffType: 'git_handoff',
    script: null,
    pack: null,
    model: 'claude-sonnet-5',
    provider: 'claude',
    ...overrides,
  };
}

function llmInvocation(overrides = {}) {
  return {
    type: 'llm_invocation',
    at: '2026-07-22T12:00:00Z',
    model: 'claude-sonnet-5',
    tokens: null,
    costUsd: 1,
    origin: llmOrigin(),
    ...overrides,
  };
}

function writeLedger(root, records) {
  const dir = llmCostTelemetryDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'llm-cost-2026-07.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────────
  registry.defineScoped(/^the LLM cost ledger stores llm_invocation records with timestamp, model, token counts, cost in dollars, and an origin block$/, () => {
    // Documentary Background line - the schema itself is exercised by
    // schema-01 below; nothing to set up here.
  }, FEATURE);

  registry.defineScoped(/^ranking is evaluated at a fixed injected instant with named horizons of 3 hours, 24 hours, and 7 days$/, (ctx) => {
    ctx.nowMs = Date.parse('2026-07-22T18:00:00Z');
    if (LLM_COST_HORIZONS_MS['3h'] !== 3 * 60 * 60 * 1000 || LLM_COST_HORIZONS_MS['24h'] !== 24 * 60 * 60 * 1000 || LLM_COST_HORIZONS_MS['7d'] !== 7 * 24 * 60 * 60 * 1000) {
      throw new Error(`expected the fixed named horizons 3h/24h/7d, got: ${JSON.stringify(LLM_COST_HORIZONS_MS)}`);
    }
  }, FEATURE);

  // ── schema-01 ───────────────────────────────────────────────────────────
  registry.defineScoped(/^an llm_invocation record is appended to the ledger$/, (ctx) => {
    ctx.record = llmInvocation({ origin: llmOrigin() });
  }, FEATURE);

  registry.defineScoped(/^it includes subsystem, role, stage, trigger, ticket id, handoff id, handoff type, script, pack, model, and provider in its origin block$/, (ctx) => {
    const missing = ORIGIN_FIELDS.filter((field) => !Object.prototype.hasOwnProperty.call(ctx.record.origin, field));
    if (missing.length) {
      throw new Error(`expected the origin block to carry every field, missing: ${missing.join(', ')}`);
    }
  }, FEATURE);

  // ── writer-handoff-02 ─────────────────────────────────────────────────────
  registry.defineScoped(/^a handoff is delivered to a role with a known ticket and handoff type$/, (ctx) => {
    ctx.ticketId = 'BL-551';
    ctx.handoffType = 'git_handoff';
  }, FEATURE);

  registry.defineScoped(/^the delivery wake is injected$/, (ctx) => {
    const out = execFileSync('bash', [HANDOFF_DELIVERY_RUNNER, ctx.ticketId, ctx.handoffType], { encoding: 'utf8' }).trim();
    ctx.writerLogLines = out === 'NO_LOG' ? [] : out.split('\n');
  }, FEATURE);

  registry.defineScoped(/^an llm_invocation correlation is recorded with trigger handoff and the handoff id and ticket id$/, (ctx) => {
    if (!ctx.writerLogLines.length) {
      throw new Error('expected an llm_invocation correlation record, got none');
    }
    const record = JSON.parse(ctx.writerLogLines[0]);
    if (record.type !== 'llm_invocation' || record.origin.trigger !== 'handoff') {
      throw new Error(`expected a handoff-trigger llm_invocation record, got: ${JSON.stringify(record)}`);
    }
    if (!record.origin.handoffId) {
      throw new Error(`expected the correlation record to carry a handoff id, got: ${JSON.stringify(record.origin)}`);
    }
    if (record.origin.ticketId !== ctx.ticketId) {
      throw new Error(`expected the correlation record's ticket id to be ${ctx.ticketId}, got: ${record.origin.ticketId}`);
    }
  }, FEATURE);

  // ── writer-reap-03 ────────────────────────────────────────────────────────
  registry.defineScoped(/^a headless claude invocation reports an exact total cost in json output$/, (ctx) => {
    ctx.resultJson = { is_error: false, result: 'ok', total_cost_usd: 0.0456, model: 'claude-opus-4-8' };
  }, FEATURE);

  registry.defineScoped(/^the invocation is reaped$/, (ctx) => {
    const out = execFileSync('bash', [REAP_RUNNER, JSON.stringify(ctx.resultJson)], { encoding: 'utf8' });
    const lines = out.trim().split('\n');
    ctx.resultFileState = lines[0];
    ctx.writerLogLines = lines[1] === 'NO_LOG' ? [] : lines.slice(1);
  }, FEATURE);

  registry.defineScoped(/^an llm_invocation record with that exact cost is appended before the result file is deleted$/, (ctx) => {
    if (ctx.resultFileState !== 'RESULT_FILE_DELETED') {
      throw new Error(`expected the result file deleted after reap, got: ${ctx.resultFileState}`);
    }
    if (!ctx.writerLogLines.length) {
      throw new Error('expected an llm_invocation record alongside the deleted result file, got none');
    }
    const record = JSON.parse(ctx.writerLogLines[0]);
    if (record.type !== 'llm_invocation' || record.costUsd !== ctx.resultJson.total_cost_usd) {
      throw new Error(`expected the recorded cost to match the reaped exact cost ${ctx.resultJson.total_cost_usd}, got: ${JSON.stringify(record)}`);
    }
    ctx.reapedRecord = record;
  }, FEATURE);

  registry.defineScoped(/^the record origin includes the reaping script name$/, (ctx) => {
    if (!ctx.reapedRecord.origin.script) {
      throw new Error(`expected the reaped record's origin to carry the reaping script name, got: ${JSON.stringify(ctx.reapedRecord.origin)}`);
    }
  }, FEATURE);

  // ── rank-single-04 ────────────────────────────────────────────────────────
  registry.defineScoped(/^llm_invocation records within and outside the last 3 hours$/, (ctx) => {
    ctx.nowMs = Date.parse('2026-07-22T18:00:00Z');
    ctx.records = [
      llmInvocation({ at: '2026-07-22T17:00:00Z', costUsd: 1 }), // inside 3h
      llmInvocation({ at: '2026-07-22T17:30:00Z', costUsd: 5 }), // inside 3h, higher cost
      llmInvocation({ at: '2026-07-22T10:00:00Z', costUsd: 99 }), // outside 3h
    ];
  }, FEATURE);

  registry.defineScoped(/^top expensive calls are ranked for the 3 hour horizon$/, (ctx) => {
    ctx.ranked = rankLlmInvocations(ctx.records, { horizonMs: LLM_COST_HORIZONS_MS['3h'], nowMs: ctx.nowMs });
  }, FEATURE);

  registry.defineScoped(/^only records inside the window are included$/, (ctx) => {
    if (ctx.ranked.records.some((r) => r.costUsd === 99)) {
      throw new Error('expected the out-of-window record to be excluded from the ranked result');
    }
    if (ctx.ranked.records.length !== 2) {
      throw new Error(`expected exactly the 2 in-window records, got ${ctx.ranked.records.length}`);
    }
  }, FEATURE);

  registry.defineScoped(/^they are ordered by cost in dollars descending with unknown costs after priced rows$/, (ctx) => {
    const costs = ctx.ranked.records.map((r) => r.costUsd);
    for (let i = 1; i < costs.length; i += 1) {
      const prev = costs[i - 1];
      const cur = costs[i];
      if (prev === null) continue;
      if (cur === null) continue;
      if (cur > prev) {
        throw new Error(`expected descending cost order, got: ${JSON.stringify(costs)}`);
      }
    }
    const firstNullIndex = costs.indexOf(null);
    if (firstNullIndex !== -1 && costs.slice(firstNullIndex).some((c) => c !== null)) {
      throw new Error(`expected every unknown-cost row to sort after every priced row, got: ${JSON.stringify(costs)}`);
    }
  }, FEATURE);

  // ── rank-horizons-05 (Scenario Outline) ────────────────────────────────────
  registry.defineScoped(/^llm_invocation records spread across the last week$/, (ctx) => {
    ctx.nowMs = Date.parse('2026-07-22T18:00:00Z');
    ctx.records = [
      llmInvocation({ at: '2026-07-22T17:00:00Z', costUsd: 1 }), // 1h ago
      llmInvocation({ at: '2026-07-22T06:00:00Z', costUsd: 2 }), // 12h ago
      llmInvocation({ at: '2026-07-20T18:00:00Z', costUsd: 3 }), // 2d ago
      llmInvocation({ at: '2026-07-10T18:00:00Z', costUsd: 4 }), // 12d ago
    ];
  }, FEATURE);

  registry.defineScoped(/^top expensive calls are ranked for the (3h|24h|7d) horizon$/, (ctx, horizon) => {
    if (!KNOWN_HORIZONS.has(horizon)) {
      throw new Error(`unrecognized Examples <horizon> value: "${horizon}"`);
    }
    ctx.horizon = horizon;
    ctx.ranked = rankLlmInvocations(ctx.records, { horizonMs: LLM_COST_HORIZONS_MS[horizon], nowMs: ctx.nowMs });
  }, FEATURE);

  registry.defineScoped(/^only records inside the (3h|24h|7d) window are included$/, (ctx, horizon) => {
    if (!KNOWN_HORIZONS.has(horizon)) {
      throw new Error(`unrecognized Examples <horizon> value: "${horizon}"`);
    }
    const horizonMs = LLM_COST_HORIZONS_MS[horizon];
    const expected = ctx.records.filter((r) => {
      const ms = Date.parse(r.at);
      return ms > ctx.nowMs - horizonMs && ms <= ctx.nowMs;
    }).length;
    if (ctx.ranked.records.length !== expected) {
      throw new Error(`expected ${expected} records inside the ${horizon} window, got ${ctx.ranked.records.length}`);
    }
  }, FEATURE);

  // ── group-by-06 ───────────────────────────────────────────────────────────
  registry.defineScoped(/^multiple llm_invocation records sharing the same trigger and role$/, (ctx) => {
    ctx.nowMs = Date.parse('2026-07-22T18:00:00Z');
    ctx.records = [
      llmInvocation({ at: '2026-07-22T17:00:00Z', costUsd: 1, origin: llmOrigin({ role: 'coder', trigger: 'handoff' }) }),
      llmInvocation({ at: '2026-07-22T17:30:00Z', costUsd: 2, origin: llmOrigin({ role: 'coder', trigger: 'handoff' }) }),
      llmInvocation({ at: '2026-07-22T17:45:00Z', costUsd: 10, origin: llmOrigin({ role: 'qa', trigger: 'reap' }) }),
    ];
  }, FEATURE);

  registry.defineScoped(/^spend is rolled up grouped by trigger and role for the 24 hour horizon$/, (ctx) => {
    ctx.rollup = rollupLlmInvocationsByOrigin(ctx.records, { horizonMs: LLM_COST_HORIZONS_MS['24h'], nowMs: ctx.nowMs, groupBy: ['trigger', 'role'] });
  }, FEATURE);

  registry.defineScoped(/^each group shows summed cost in dollars and invocation count$/, (ctx) => {
    const coderGroup = ctx.rollup.find((g) => g.key.role === 'coder');
    if (!coderGroup || coderGroup.costUsd !== 3 || coderGroup.invocationCount !== 2) {
      throw new Error(`expected the coder/handoff group summed to $3 across 2 invocations, got: ${JSON.stringify(coderGroup)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^groups are ordered by summed cost descending$/, (ctx) => {
    const costs = ctx.rollup.map((g) => g.costUsd);
    for (let i = 1; i < costs.length; i += 1) {
      if (costs[i] > costs[i - 1]) {
        throw new Error(`expected groups ordered by summed cost descending, got: ${JSON.stringify(costs)}`);
      }
    }
  }, FEATURE);

  // ── unknown-cost-07 ───────────────────────────────────────────────────────
  registry.defineScoped(/^a priced invocation and an invocation with unknown cost in the same window$/, (ctx) => {
    ctx.nowMs = Date.parse('2026-07-22T18:00:00Z');
    ctx.records = [
      llmInvocation({ at: '2026-07-22T17:00:00Z', costUsd: 7 }),
      llmInvocation({ at: '2026-07-22T17:30:00Z', costUsd: null }),
    ];
  }, FEATURE);

  registry.defineScoped(/^top expensive calls are ranked for the 24 hour horizon$/, (ctx) => {
    ctx.ranked = rankLlmInvocations(ctx.records, { horizonMs: LLM_COST_HORIZONS_MS['24h'], nowMs: ctx.nowMs });
  }, FEATURE);

  registry.defineScoped(/^the dollar total includes only the priced invocation$/, (ctx) => {
    if (ctx.ranked.totalCostUsd !== 7) {
      throw new Error(`expected the dollar total to count only the priced $7 invocation, got: ${ctx.ranked.totalCostUsd}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the unknown-cost invocation is never counted as zero dollars$/, (ctx) => {
    // Structural proof, not a numeric coincidence: unknownCostCount is a
    // DISTINCT counter a "silently coerce to $0 and sum" implementation
    // would never populate.
    if (ctx.ranked.unknownCostCount !== 1) {
      throw new Error(`expected the unknown-cost invocation counted separately (not zeroed), got unknownCostCount=${ctx.ranked.unknownCostCount}`);
    }
  }, FEATURE);

  // ── bridge-08 ─────────────────────────────────────────────────────────────
  registry.defineScoped(/^llm_invocation records in the ledger$/, (ctx) => {
    ctx.bridgeRoot = mkTmpDir('bl551-bridge-');
    ctx.bridgeNowMs = Date.parse('2026-07-22T18:00:00Z');
    writeLedger(ctx.bridgeRoot, [
      llmInvocation({ at: '2026-07-22T17:00:00Z', costUsd: 1, origin: llmOrigin({ role: 'coder' }) }),
      llmInvocation({ at: '2026-07-22T17:30:00Z', costUsd: 5, origin: llmOrigin({ role: 'qa' }) }),
    ]);
  }, FEATURE);

  registry.defineScoped(/^an authorized request is made to the cost rank endpoint for the 24 hour horizon$/, async (ctx) => {
    const handle = await startBridge(ctx.bridgeRoot, path.join(ctx.bridgeRoot, 'runs.jsonl'), BRIDGE_TOKEN, { nowMs: ctx.bridgeNowMs });
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/cost-rank?horizon=24h`, {
        headers: { authorization: `Bearer ${BRIDGE_TOKEN}` },
      });
      ctx.bridgeStatus = res.status;
      ctx.bridgeBody = await res.json();
    } finally {
      handle.stop();
    }
  }, FEATURE);

  registry.defineScoped(/^the response lists top expensive calls with origin attribution for that horizon$/, (ctx) => {
    if (ctx.bridgeStatus !== 200) {
      throw new Error(`expected a 200 response from the cost-rank endpoint, got: ${ctx.bridgeStatus}`);
    }
    if (ctx.bridgeBody.horizon !== '24h') {
      throw new Error(`expected the response to echo the requested 24h horizon, got: ${ctx.bridgeBody.horizon}`);
    }
    if (!Array.isArray(ctx.bridgeBody.records) || ctx.bridgeBody.records.length !== 2) {
      throw new Error(`expected 2 ranked records with origin attribution, got: ${JSON.stringify(ctx.bridgeBody)}`);
    }
    if (!ctx.bridgeBody.records.every((r) => r.origin && typeof r.origin.role === 'string')) {
      throw new Error(`expected every ranked record to carry origin attribution, got: ${JSON.stringify(ctx.bridgeBody.records)}`);
    }
    if (ctx.bridgeBody.records[0].costUsd !== 5) {
      throw new Error(`expected the top ranked record to be the $5 invocation, got: ${JSON.stringify(ctx.bridgeBody.records[0])}`);
    }
  }, FEATURE);

  // ── sidecar-09 ────────────────────────────────────────────────────────────
  registry.defineScoped(/^llm_invocation records across the last week$/, (ctx) => {
    ctx.sidecarRoot = mkTmpDir('bl551-sidecar-');
    execFileSync('git', ['init', '-q'], { cwd: ctx.sidecarRoot });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: ctx.sidecarRoot });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: ctx.sidecarRoot });
    execFileSync('git', ['commit', '-q', '-m', 'init', '--allow-empty'], { cwd: ctx.sidecarRoot });
    ctx.sidecarNowMs = Date.parse('2026-07-22T18:00:00Z');
    writeLedger(ctx.sidecarRoot, [
      llmInvocation({ at: '2026-07-22T17:00:00Z', costUsd: 5, origin: llmOrigin({ role: 'coder', trigger: 'handoff' }) }), // 3h
      llmInvocation({ at: '2026-07-21T18:00:00Z', costUsd: 8, origin: llmOrigin({ role: 'qa', trigger: 'reap' }) }), // 24h
      llmInvocation({ at: '2026-07-17T18:00:00Z', costUsd: 12, origin: llmOrigin({ role: 'architect', trigger: 'human_chat' }) }), // 7d
    ]);
  }, FEATURE);

  registry.defineScoped(/^the cost health sidecar is emitted for the day$/, (ctx) => {
    ctx.sidecar = computeCostHealthSidecar(ctx.sidecarRoot, [{ role: 'coder', worktreePath: ctx.sidecarRoot }], ctx.sidecarNowMs);
    ctx.sidecarText = renderCostHealthSection(ctx.sidecar);
  }, FEATURE);

  registry.defineScoped(/^it includes top expensive origins for the 3 hour, 24 hour, and 7 day horizons$/, (ctx) => {
    for (const horizon of ['3h', '24h', '7d']) {
      if (!ctx.sidecar.topExpensiveOriginsByHorizon || !Array.isArray(ctx.sidecar.topExpensiveOriginsByHorizon[horizon])) {
        throw new Error(`expected topExpensiveOriginsByHorizon.${horizon} to be an array, got: ${JSON.stringify(ctx.sidecar.topExpensiveOriginsByHorizon)}`);
      }
    }
    if (ctx.sidecar.topExpensiveOriginsByHorizon['7d'].length === 0) {
      throw new Error('expected the 7d horizon to include at least the oldest seeded record');
    }
    if (!/Top expensive origins:/.test(ctx.sidecarText)) {
      throw new Error(`expected the rendered briefing section to include a "Top expensive origins:" heading, got: ${ctx.sidecarText}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
