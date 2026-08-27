'use strict';

// BL-565: step handlers for "Cost ledger captures Max-billed role tokens and
// synthetic list-price dollars". Drives the REAL compiled read side
// (syntheticLlmCost.ts, llmCostLedger.ts, llmCostLedgerStore.ts), swarm-cost-rank,
// bridge /cost-rank, cost health sidecar, and the bl565 handoff delivery
// acceptance runner — never a hand-rolled reimplementation (APS rule).
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
const {
  deriveSyntheticCostUsd,
  enrichLlmInvocationRecord,
  isUnknownSyntheticPrice,
  PRICING_TABLE_AS_OF_LABEL,
} = require(path.join(EXT_OUT, 'metrics', 'syntheticLlmCost'));
const { PRICING_TABLE_VERSION } = require(path.join(EXT_OUT, 'metrics', 'pricingTable'));
const { startBridge } = require(path.join(EXT_OUT, 'bridge', 'bridgeServer'));
const { runSwarmCostRank } = require(path.join(EXT_OUT, 'tools', 'swarm-cost-rank'));
const { computeCostHealthSidecar, renderCostHealthSection } = require(path.join(EXT_OUT, 'notify', 'costHealthSidecar'));

const HANDOFF_TELEMETRY_RUNNER = path.join(SCRIPTS_DIR, 'bl565_handoff_delivery_with_telemetry_runner.sh');
const REAP_RUNNER = path.join(SCRIPTS_DIR, 'bl551_reap_llm_cost_ledger_acceptance_runner.sh');
const LLM_COST_LEDGER_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'llm_cost_ledger_lib.bb');
const OPERATOR_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_lib.bb');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');

const BRIDGE_TOKEN = 'bl565-token';
const FEATURE = 'Cost ledger captures Max-billed role tokens and synthetic list-price dollars';

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function llmOrigin(overrides = {}) {
  return {
    subsystem: 'pipeline',
    role: 'coder',
    stage: 'coder',
    trigger: 'handoff',
    ticketId: 'BL-565',
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
    tokens: { inputTokens: 1_000_000, outputTokens: 500_000, cacheCreationTokens: 0, cacheReadTokens: 0 },
    costUsd: null,
    origin: llmOrigin(),
    ...overrides,
  };
}

function writeLedger(root, records) {
  const dir = llmCostTelemetryDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'llm-cost-2026-07.jsonl'),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────────
  registry.defineScoped(/^the LLM cost ledger stores llm_invocation records per BL-551$/, () => {
    // Documentary — BL-551 schema is exercised by the writer and rollup scenarios.
  }, FEATURE);

  registry.defineScoped(/^a committed list-price table with an as_of date labels synthetic estimates$/, () => {
    if (!Number.isFinite(PRICING_TABLE_VERSION) || PRICING_TABLE_VERSION < 1) {
      throw new Error(`expected a committed pricing table version, got: ${PRICING_TABLE_VERSION}`);
    }
    if (!PRICING_TABLE_AS_OF_LABEL.includes(String(PRICING_TABLE_VERSION))) {
      throw new Error(`expected synthetic estimates labelled with pricing table as_of, got: ${PRICING_TABLE_AS_OF_LABEL}`);
    }
  }, FEATURE);

  // ── pipeline-record-carries-tokens-01 ─────────────────────────────────────
  registry.defineScoped(/^a pipeline handoff delivery wakes a role whose turn usage is observable$/, (ctx) => {
    ctx.ticketId = 'BL-565';
    ctx.handoffType = 'git_handoff';
    ctx.seedTelemetry = 'yes';
  }, FEATURE);

  registry.defineScoped(/^an llm_invocation record is appended for that delivery$/, (ctx) => {
    const seed = ctx.seedTelemetry ?? 'yes';
    const out = execFileSync('bash', [HANDOFF_TELEMETRY_RUNNER, ctx.ticketId, ctx.handoffType, seed], { encoding: 'utf8' }).trim();
    ctx.writerLogLines = out === 'NO_LOG' ? [] : out.split('\n');
    ctx.deliveryRecord = ctx.writerLogLines.length ? JSON.parse(ctx.writerLogLines[0]) : null;
  }, FEATURE);

  registry.defineScoped(/^the record carries non-null input and output token counts at minimum$/, (ctx) => {
    if (!ctx.deliveryRecord?.tokens) {
      throw new Error(`expected non-null tokens on the delivery record, got: ${JSON.stringify(ctx.deliveryRecord)}`);
    }
    if (ctx.deliveryRecord.tokens.inputTokens == null || ctx.deliveryRecord.tokens.outputTokens == null) {
      throw new Error(`expected input and output token counts, got: ${JSON.stringify(ctx.deliveryRecord.tokens)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^delivery completes even if token capture fails$/, (ctx) => {
    const out = execFileSync('bash', [HANDOFF_TELEMETRY_RUNNER, ctx.ticketId, ctx.handoffType, 'no'], { encoding: 'utf8' }).trim();
    if (out === 'NO_LOG') {
      throw new Error('expected delivery to append an llm_invocation record even without telemetry');
    }
    const record = JSON.parse(out.split('\n')[0]);
    if (record.tokens !== null) {
      throw new Error('expected null tokens when telemetry is absent, proving capture failure degrades without blocking');
    }
  }, FEATURE);

  // ── unobservable-usage-degrades-null-02 ─────────────────────────────────────
  registry.defineScoped(/^a pipeline invocation whose per-turn usage cannot be read$/, (ctx) => {
    ctx.ticketId = 'BL-565';
    ctx.handoffType = 'git_handoff';
    ctx.useReapPath = false;
  }, FEATURE);

  registry.defineScoped(/^an llm_invocation record is appended$/, (ctx) => {
    if (ctx.useReapPath) {
      ctx.resultJson = { is_error: false, result: 'ok', total_cost_usd: null, model: 'claude-opus-4-8' };
      const out = execFileSync('bash', [REAP_RUNNER, JSON.stringify(ctx.resultJson)], { encoding: 'utf8' });
      ctx.writerLogLines = out.trim().split('\n').slice(1);
      ctx.writerLogLines = ctx.writerLogLines[0] === 'NO_LOG' ? [] : ctx.writerLogLines;
    } else {
      const out = execFileSync('bash', [HANDOFF_TELEMETRY_RUNNER, ctx.ticketId, ctx.handoffType, 'no'], { encoding: 'utf8' }).trim();
      ctx.writerLogLines = out === 'NO_LOG' ? [] : out.split('\n');
    }
    ctx.deliveryRecord = ctx.writerLogLines.length ? JSON.parse(ctx.writerLogLines[0]) : null;
  }, FEATURE);

  registry.defineScoped(/^the record tokens field is null$/, (ctx) => {
    if (!ctx.deliveryRecord || ctx.deliveryRecord.tokens !== null) {
      throw new Error(`expected tokens null when usage was not observable, got: ${JSON.stringify(ctx.deliveryRecord?.tokens)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the handoff or reap path still completes without error$/, (ctx) => {
    if (!ctx.writerLogLines?.length) {
      throw new Error('expected the writer path to append a record without error');
    }
  }, FEATURE);

  // ── synthetic-distinct-from-billed-03 ───────────────────────────────────────
  registry.defineScoped(/^an llm_invocation record with non-null tokens and a model in the price table$/, (ctx) => {
    ctx.record = llmInvocation();
  }, FEATURE);

  registry.defineScoped(/^the record has no provider-billed cost$/, (ctx) => {
    if (ctx.record.costUsd !== null) {
      throw new Error(`expected no billed costUsd, got: ${ctx.record.costUsd}`);
    }
  }, FEATURE);

  registry.defineScoped(/^synthetic cost is derived for that record$/, (ctx) => {
    ctx.enriched = enrichLlmInvocationRecord(ctx.record);
    ctx.synthetic = deriveSyntheticCostUsd(ctx.record);
  }, FEATURE);

  registry.defineScoped(/^syntheticCostUsd is a positive estimate from list prices$/, (ctx) => {
    if (!(ctx.synthetic > 0)) {
      throw new Error(`expected a positive synthetic estimate, got: ${ctx.synthetic}`);
    }
    if (!(ctx.enriched.syntheticCostUsd > 0)) {
      throw new Error(`expected enrich to attach syntheticCostUsd, got: ${JSON.stringify(ctx.enriched)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^costUsd remains null$/, (ctx) => {
    if (ctx.enriched.costUsd !== null) {
      throw new Error(`expected costUsd to stay null, got: ${ctx.enriched.costUsd}`);
    }
  }, FEATURE);

  // ── billed-cost-unchanged-04 ────────────────────────────────────────────────
  registry.defineScoped(/^an llm_invocation record with a provider-reported costUsd$/, (ctx) => {
    ctx.nowMs = Date.parse('2026-07-22T18:00:00Z');
    ctx.record = llmInvocation({ costUsd: 0.74, tokens: null, origin: llmOrigin({ role: 'front-desk-operator', subsystem: 'front_desk', trigger: 'reap' }) });
    ctx.records = [ctx.record];
  }, FEATURE);

  registry.defineScoped(/^rollups classify the record$/, (ctx) => {
    ctx.ranked = rankLlmInvocations(ctx.records.map(enrichLlmInvocationRecord), {
      horizonMs: LLM_COST_HORIZONS_MS['7d'],
      nowMs: ctx.nowMs,
    });
  }, FEATURE);

  registry.defineScoped(/^costUsd counts toward billed totals$/, (ctx) => {
    if (ctx.ranked.totalCostUsd !== 0.74) {
      throw new Error(`expected billed total $0.74, got: ${ctx.ranked.totalCostUsd}`);
    }
  }, FEATURE);

  registry.defineScoped(/^syntheticCostUsd is not substituted for the billed amount$/, (ctx) => {
    if (deriveSyntheticCostUsd(ctx.record) !== null) {
      throw new Error('expected no synthetic substitute for a billed row');
    }
    if (ctx.ranked.totalSyntheticCostUsd !== 0) {
      throw new Error(`expected synthetic total 0 for billed-only window, got: ${ctx.ranked.totalSyntheticCostUsd}`);
    }
  }, FEATURE);

  // ── rollups-separate-columns-05 ─────────────────────────────────────────────
  registry.defineScoped(/^priced billed records and Max-billed records with syntheticCostUsd in the same window$/, (ctx) => {
    ctx.nowMs = Date.parse('2026-07-22T18:00:00Z');
    ctx.rollupRoot = mkTmpDir('bl565-rollup-');
    ctx.records = [
      llmInvocation({ at: '2026-07-22T17:00:00Z', costUsd: null, origin: llmOrigin({ role: 'coder' }) }),
      llmInvocation({
        at: '2026-07-22T17:30:00Z',
        costUsd: 2,
        tokens: null,
        origin: llmOrigin({ role: 'front-desk-operator', subsystem: 'front_desk', trigger: 'reap' }),
      }),
    ].map(enrichLlmInvocationRecord);
    writeLedger(ctx.rollupRoot, ctx.records);
  }, FEATURE);

  registry.defineScoped(/^the 7 day horizon rollup runs via swarm-cost-rank or the cost rank endpoint$/, async (ctx) => {
    ctx.cliResult = runSwarmCostRank({ horizon: '7d', topN: undefined, groupBy: [] }, ctx.rollupRoot, ctx.nowMs);
    const handle = await startBridge(ctx.rollupRoot, path.join(ctx.rollupRoot, 'runs.jsonl'), BRIDGE_TOKEN, { nowMs: ctx.nowMs });
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/cost-rank?horizon=7d`, {
        headers: { authorization: `Bearer ${BRIDGE_TOKEN}` },
      });
      ctx.bridgeBody = await res.json();
    } finally {
      handle.stop();
    }
  }, FEATURE);

  registry.defineScoped(/^the output shows a billed total and a synthetic estimate total as separate labelled values$/, (ctx) => {
    if (ctx.cliResult.totalCostUsd !== 2) {
      throw new Error(`expected CLI billed total $2, got: ${ctx.cliResult.totalCostUsd}`);
    }
    if (!(ctx.cliResult.totalSyntheticCostUsd > 0)) {
      throw new Error(`expected CLI synthetic total > 0, got: ${ctx.cliResult.totalSyntheticCostUsd}`);
    }
    if (ctx.bridgeBody.totalCostUsd !== 2 || !(ctx.bridgeBody.totalSyntheticCostUsd > 0)) {
      throw new Error(`expected bridge to expose separate billed/synthetic totals, got: ${JSON.stringify(ctx.bridgeBody)}`);
    }
    if (ctx.bridgeBody.pricingTableAsOf !== PRICING_TABLE_AS_OF_LABEL) {
      throw new Error(`expected pricing table as_of on bridge response, got: ${ctx.bridgeBody.pricingTableAsOf}`);
    }
  }, FEATURE);

  registry.defineScoped(/^they are never summed together silently$/, (ctx) => {
    const silentSum = ctx.cliResult.totalCostUsd + ctx.cliResult.totalSyntheticCostUsd;
    if (ctx.cliResult.totalCostUsd === silentSum || ctx.cliResult.totalSyntheticCostUsd === silentSum) {
      throw new Error('expected distinct billed and synthetic counters, not one silent combined total');
    }
  }, FEATURE);

  // ── unknown-model-unknown-price-bucket-06 ───────────────────────────────────
  registry.defineScoped(/^an llm_invocation record with tokens and a model id absent from the price table$/, (ctx) => {
    ctx.nowMs = Date.parse('2026-07-22T18:00:00Z');
    ctx.record = llmInvocation({ model: 'unknown-model-x', origin: llmOrigin({ model: 'unknown-model-x' }) });
    ctx.records = [ctx.record];
  }, FEATURE);

  registry.defineScoped(/^synthetic cost is derived$/, (ctx) => {
    ctx.synthetic = deriveSyntheticCostUsd(ctx.record);
    ctx.ranked = rankLlmInvocations(ctx.records.map(enrichLlmInvocationRecord), {
      horizonMs: LLM_COST_HORIZONS_MS['7d'],
      nowMs: ctx.nowMs,
    });
  }, FEATURE);

  registry.defineScoped(/^syntheticCostUsd is null$/, (ctx) => {
    if (ctx.synthetic !== null) {
      throw new Error(`expected null synthetic for unknown model, got: ${ctx.synthetic}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the rollup counts it in an unknown-price bucket$/, (ctx) => {
    if (ctx.ranked.unknownSyntheticPriceCount !== 1) {
      throw new Error(`expected unknownSyntheticPriceCount 1, got: ${ctx.ranked.unknownSyntheticPriceCount}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the rollup does not treat it as zero dollars or crash$/, (ctx) => {
    if (ctx.ranked.totalSyntheticCostUsd !== 0) {
      throw new Error(`expected synthetic total 0, not fabricated, got: ${ctx.ranked.totalSyntheticCostUsd}`);
    }
    if (ctx.ranked.records.length !== 1) {
      throw new Error(`expected the record to remain visible, got: ${ctx.ranked.records.length}`);
    }
  }, FEATURE);

  // ── role-rollup-ranks-by-synthetic-07 ─────────────────────────────────────
  registry.defineScoped(/^Max-billed pipeline roles with syntheticCostUsd on their records$/, (ctx) => {
    ctx.nowMs = Date.parse('2026-07-22T18:00:00Z');
    ctx.maxBilled = [
      llmInvocation({ at: '2026-07-22T17:00:00Z', tokens: { inputTokens: 100_000, outputTokens: 50_000, cacheCreationTokens: 0, cacheReadTokens: 0 }, origin: llmOrigin({ role: 'architect' }) }),
      llmInvocation({ at: '2026-07-22T17:10:00Z', tokens: { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, origin: llmOrigin({ role: 'coder' }) }),
    ].map(enrichLlmInvocationRecord);
  }, FEATURE);

  registry.defineScoped(/^an OpenRouter-billed role with real costUsd$/, (ctx) => {
    ctx.billed = llmInvocation({
      at: '2026-07-22T17:20:00Z',
      costUsd: 0.5,
      tokens: null,
      origin: llmOrigin({ role: 'front-desk-operator', subsystem: 'front_desk', trigger: 'reap' }),
    });
    ctx.records = [...ctx.maxBilled, ctx.billed];
  }, FEATURE);

  registry.defineScoped(/^the 7 day rollup groups by role$/, (ctx) => {
    ctx.rollup = rollupLlmInvocationsByOrigin(ctx.records, {
      horizonMs: LLM_COST_HORIZONS_MS['7d'],
      nowMs: ctx.nowMs,
      groupBy: ['role'],
    });
  }, FEATURE);

  registry.defineScoped(/^Max-billed roles are ordered by summed syntheticCostUsd descending$/, (ctx) => {
    const maxRoles = ctx.rollup.filter((g) => g.key.role === 'architect' || g.key.role === 'coder');
    if (maxRoles.length !== 2) {
      throw new Error(`expected architect and coder groups, got: ${JSON.stringify(ctx.rollup)}`);
    }
    if (maxRoles[0].key.role !== 'coder' || maxRoles[1].key.role !== 'architect') {
      throw new Error(`expected coder ranked above architect by synthetic dollars, got: ${JSON.stringify(maxRoles.map((g) => g.key.role))}`);
    }
    if (!(maxRoles[0].syntheticCostUsd > maxRoles[1].syntheticCostUsd)) {
      throw new Error(`expected descending synthetic totals, got: ${JSON.stringify(maxRoles)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^invocation count alone is not the only ranking signal for those roles$/, (ctx) => {
    const architect = ctx.rollup.find((g) => g.key.role === 'architect');
    const coder = ctx.rollup.find((g) => g.key.role === 'coder');
    if (architect.invocationCount !== 1 || coder.invocationCount !== 1) {
      throw new Error('expected equal invocation counts so synthetic dollars decide order');
    }
    if (architect.syntheticCostUsd === coder.syntheticCostUsd) {
      throw new Error('expected different synthetic totals to break the tie');
    }
  }, FEATURE);

  // ── prefers-existing-telemetry-08 ───────────────────────────────────────────
  registry.defineScoped(/^pipeline writers populate tokens on llm_invocation records$/, () => {
    // Documentary trigger — wiring proof is in the Then steps below.
  }, FEATURE);

  registry.defineScoped(/^they read from the existing context-telemetry or transcript usage path$/, () => {
    const ledgerLib = fs.readFileSync(LLM_COST_LEDGER_LIB, 'utf8');
    const handoffd = fs.readFileSync(HANDOFFD, 'utf8');
    if (!ledgerLib.includes('latest-role-usage-from-context-events')) {
      throw new Error('expected llm_cost_ledger_lib to read GH-22 context-events for token capture');
    }
    if (!ledgerLib.includes('context-events.jsonl') && !ledgerLib.includes('read-events!')) {
      throw new Error('expected llm_cost_ledger_lib to use context-events.jsonl via read-events!');
    }
    if (!handoffd.includes('latest-role-usage-from-context-events')) {
      throw new Error('expected handoffd deliver! to call the context-events reader before append');
    }
  }, FEATURE);

  registry.defineScoped(/^they do not introduce a parallel unsupervised usage collector when that path suffices$/, () => {
    const operatorLib = fs.readFileSync(OPERATOR_LIB, 'utf8');
    if (/parallel.*collector|unsupervised.*usage/i.test(operatorLib)) {
      throw new Error('expected no parallel unsupervised usage collector in operator_lib');
    }
    const ledgerLib = fs.readFileSync(LLM_COST_LEDGER_LIB, 'utf8');
    if (!ledgerLib.includes('context-events.jsonl') && !ledgerLib.includes('read-events!')) {
      throw new Error('expected token capture to reuse context-events store, not a new collector');
    }
  }, FEATURE);

  // ── sidecar-labels-estimate-09 ──────────────────────────────────────────────
  registry.defineScoped(/^rollups include synthetic totals for a horizon$/, (ctx) => {
    ctx.sidecarNowMs = Date.parse('2026-07-22T18:00:00Z');
    ctx.byHorizon = {
      '3h': [],
      '24h': [{
        key: { role: 'coder', trigger: 'handoff' },
        costUsd: 0,
        syntheticCostUsd: 4.5,
        invocationCount: 2,
        unknownCostCount: 2,
        unknownSyntheticPriceCount: 0,
      }],
      '7d': [],
    };
  }, FEATURE);

  registry.defineScoped(/^the daily cost health sidecar is emitted$/, (ctx) => {
    ctx.sidecarRoot = mkTmpDir('bl565-sidecar-');
    execFileSync('git', ['init', '-q'], { cwd: ctx.sidecarRoot });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: ctx.sidecarRoot });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: ctx.sidecarRoot });
    execFileSync('git', ['commit', '-q', '-m', 'init', '--allow-empty'], { cwd: ctx.sidecarRoot });
    writeLedger(ctx.sidecarRoot, [
      llmInvocation({ at: '2026-07-22T17:00:00Z', origin: llmOrigin({ role: 'coder', trigger: 'handoff' }) }),
    ].map(enrichLlmInvocationRecord));
    ctx.sidecar = computeCostHealthSidecar(ctx.sidecarRoot, [{ role: 'coder', worktreePath: ctx.sidecarRoot }], ctx.sidecarNowMs);
    ctx.sidecarText = renderCostHealthSection(ctx.sidecar);
  }, FEATURE);

  registry.defineScoped(/^synthetic lines are labelled as estimates$/, (ctx) => {
    if (!/est \(/.test(ctx.sidecarText)) {
      throw new Error(`expected synthetic lines labelled as estimates, got: ${ctx.sidecarText}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the output names the pricing table as_of date$/, (ctx) => {
    if (!ctx.sidecarText.includes(PRICING_TABLE_AS_OF_LABEL)) {
      throw new Error(`expected pricing table as_of in sidecar output, got: ${ctx.sidecarText}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
