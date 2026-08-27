'use strict';

// BL-666: budget-aware shift governor acceptance — drives real governor + BL-664 walker.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT = path.join(REPO_ROOT, 'extension');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const MODEL_FACTORY_CLI = path.join(SCRIPTS, 'model_factory_cli.bb');
const FEATURE = 'Budget-aware shift governor projects burn and chooses shift verdict';

const {
  DEFAULT_BUDGET_GOVERNOR_CONFIG,
  runBudgetShiftGovernor,
  runAnchorCalibration,
  bl664WalkerBurnMeter,
  isAnchorStale,
} = require(path.join(EXT, 'out', 'metrics', 'budgetShiftGovernor'));
const { walkTranscriptFiles } = require(path.join(EXT, 'out', 'metrics', 'transcriptWalker'));

const T1 = Date.parse('2026-07-20T12:00:00Z');
const T2 = Date.parse('2026-07-22T12:00:00Z');

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function ensureCtx(ctx) {
  if (!ctx.bl666) {
    ctx.bl666 = { config: { ...DEFAULT_BUDGET_GOVERNOR_CONFIG } };
  }
  return ctx.bl666;
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function factoryCli(ctx, args) {
  return execFileSync('bb', [MODEL_FACTORY_CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MODEL_STEWARD_STATE_DIR: ctx.stewardStateDir,
      MODEL_FACTORY_STATE_DIR: ctx.factoryStateDir,
    },
  });
}

function registerSteps(registry) {
  scoped(registry, /^the budget-aware shift governor is configured for a prepaid plan$/, (ctx) => {
    const st = ensureCtx(ctx);
    st.config = { ...DEFAULT_BUDGET_GOVERNOR_CONFIG, planKind: 'prepaid' };
  });

  scoped(registry, /^anchor usage is "([^"]+)" percent at "([^"]+)" days into the weekly window$/, (ctx, pct, days) => {
    const st = ensureCtx(ctx);
    const used = Number(pct);
    st.input = {
      remainingPercent: 100 - used,
      daysToReset: 7 - Number(days),
      measuredBurnPercentPerDay: st.input?.measuredBurnPercentPerDay ?? 10,
      affordableBurnPercentPerDay: st.input?.affordableBurnPercentPerDay ?? 6,
    };
  });

  scoped(registry, /^measured burn is "([^"]+)" percent per day$/, (ctx, rate) => {
    const st = ensureCtx(ctx);
    st.input = { ...st.input, measuredBurnPercentPerDay: Number(rate) };
  });

  scoped(registry, /^affordable burn is "([^"]+)" percent per day to reach replenish$/, (ctx, rate) => {
    const st = ensureCtx(ctx);
    st.input = { ...st.input, affordableBurnPercentPerDay: Number(rate) };
  });

  scoped(registry, /^the governor runs at the shift boundary$/, (ctx) => {
    const st = ensureCtx(ctx);
    st.result = runBudgetShiftGovernor(st.config, st.input);
  });

  scoped(registry, /^the verdict is not full shift$/, (ctx) => {
    if (ctx.bl666.result.verdict === 'full') {
      throw new Error(`expected non-full verdict, got ${ctx.bl666.result.verdict}`);
    }
  });

  scoped(registry, /^the announcement includes remaining percent days-to-reset and measured burn per shift$/, (ctx) => {
    const ann = ctx.bl666.result.announcement;
    if (!/remaining \d/.test(ann) || !/days-to-reset/.test(ann) || !/measured burn\/shift/.test(ann)) {
      throw new Error(`announcement missing required arithmetic: ${ann}`);
    }
  });

  scoped(registry, /^anchor A reports usage "([^"]+)" percent at timestamp T1$/, (ctx, pct) => {
    const st = ensureCtx(ctx);
    st.anchorA = { atMs: T1, pct: Number(pct), scope: 'all-models' };
  });

  scoped(registry, /^anchor B reports usage "([^"]+)" percent at timestamp T2 after measurable transcript burn$/, (ctx, pct) => {
    const st = ensureCtx(ctx);
    st.anchorB = { atMs: T2, pct: Number(pct), scope: 'all-models' };
    const transcriptDir = mkTmp('bl666-cal-');
    const transcriptPath = path.join(transcriptDir, 'sess.jsonl');
    fs.writeFileSync(
      transcriptPath,
      `${JSON.stringify({ type: 'assistant', timestamp: new Date(T1 + 3600000).toISOString(), message: { content: [{ type: 'text', text: 'work' }] } })}\n`
    );
    const walk = walkTranscriptFiles([transcriptPath], []);
    st.walkerBurn = bl664WalkerBurnMeter(walk.intervals, T1, T2);
  });

  scoped(registry, /^calibration runs between anchors$/, (ctx) => {
    const st = ensureCtx(ctx);
    st.calibration = runAnchorCalibration(st.anchorA, st.anchorB, st.walkerBurn.burnPercentPerDay);
  });

  scoped(registry, /^projected usage gauge is labelled calibrated$/, (ctx) => {
    if (ctx.bl666.calibration.projectedGaugeLabel !== 'calibrated') {
      throw new Error(`expected calibrated label, got ${ctx.bl666.calibration.projectedGaugeLabel}`);
    }
  });

  scoped(registry, /^burn between anchors is derived from the BL-664 transcript walker$/, (ctx) => {
    if (!ctx.bl666.calibration.burnBetweenAnchorsFromWalker) {
      throw new Error('expected BL-664 walker-derived burn between anchors');
    }
    if (ctx.bl666.walkerBurn.source !== 'bl664-walker') {
      throw new Error('walker burn meter must cite bl664-walker source');
    }
  });

  scoped(registry, /^the last human anchor is older than the stale threshold$/, (ctx) => {
    const st = ensureCtx(ctx);
    const nowMs = Date.now();
    st.input = {
      remainingPercent: 25,
      daysToReset: 4,
      measuredBurnPercentPerDay: 20,
      affordableBurnPercentPerDay: 6,
      degradedMode: isAnchorStale(nowMs - 5 * 86400000, nowMs, st.config.staleAnchorThresholdMs),
    };
  });

  scoped(registry, /^the verdict announcement labels degraded mode$/, (ctx) => {
    if (!ctx.bl666.result.degraded || !/degraded mode/i.test(ctx.bl666.result.announcement)) {
      throw new Error(`expected degraded announcement, got ${ctx.bl666.result.announcement}`);
    }
  });

  scoped(registry, /^no confident burn projection is presented as exact$/, (ctx) => {
    if (ctx.bl666.result.exactProjection) {
      throw new Error('degraded mode must not present exact projection');
    }
  });

  scoped(registry, /^remaining budget percent and days-to-reset allow a trimmed shift but not full hours$/, (ctx) => {
    const st = ensureCtx(ctx);
    st.input = {
      remainingPercent: 40,
      daysToReset: 5,
      measuredBurnPercentPerDay: 8,
      affordableBurnPercentPerDay: 7,
    };
  });

  scoped(registry, /^the verdict is SHORT shift$/, (ctx) => {
    if (ctx.bl666.result.verdict !== 'SHORT') {
      throw new Error(`expected SHORT, got ${ctx.bl666.result.verdict}`);
    }
  });

  scoped(registry, /^the announcement states trimmed hours and its arithmetic$/, (ctx) => {
    const ann = ctx.bl666.result.announcement;
    if (!/trimmed hours/.test(ann) || !/remaining/.test(ann)) {
      throw new Error(`SHORT announcement missing trimmed hours: ${ann}`);
    }
  });

  scoped(registry, /^remaining budget percent and days-to-reset require cheaper seats$/, (ctx) => {
    const st = ensureCtx(ctx);
    st.input = {
      remainingPercent: 20,
      daysToReset: 4,
      measuredBurnPercentPerDay: 12,
      affordableBurnPercentPerDay: 5,
    };
    st.result = runBudgetShiftGovernor(st.config, st.input);
    st.stewardStateDir = mkTmp('bl666-steward-');
    st.factoryStateDir = mkTmp('bl666-factory-');
    fs.writeFileSync(
      path.join(st.stewardStateDir, 'registry.json'),
      JSON.stringify({
        models: {
          'openai/gpt-5.3-codex': {
            provider: 'openai',
            model: 'gpt-5.3-codex',
            status: 'certified',
            cost_class: 'low',
            certification_report_path: null,
          },
          'anthropic/claude-sonnet-5': {
            provider: 'anthropic',
            model: 'claude-sonnet-5',
            status: 'certified',
            cost_class: 'high',
            certification_report_path: null,
          },
        },
        capabilities: {},
        role_matrix: {
          coder: [
            { provider: 'anthropic', model: 'claude-sonnet-5', score: 0.95, evidence: 'fixture' },
            { provider: 'openai', model: 'gpt-5.3-codex', score: 0.6, evidence: 'fixture' },
          ],
        },
        adapters: {},
      })
    );
  });

  scoped(registry, /^the verdict is CHEAP shift$/, (ctx) => {
    if (ctx.bl666.result.verdict !== 'CHEAP') {
      throw new Error(`expected CHEAP, got ${ctx.bl666.result.verdict}`);
    }
  });

  scoped(registry, /^seat assignment uses ModelFactory assign mode cheap for certified seats only$/, (ctx) => {
    const out = factoryCli(ctx.bl666, ['assign', '--mode', 'cheap', '--role', 'coder']);
    const parsed = JSON.parse(out);
    if (!parsed.provider || !parsed.model) {
      throw new Error(`ModelFactory cheap assign missing provider/model: ${out.slice(0, 200)}`);
    }
    if (!ctx.bl666.result.cheapMode) {
      throw new Error('governor result must flag cheap mode for CHEAP verdict');
    }
  });

  scoped(registry, /^remaining budget percent and days-to-reset require SKIP$/, (ctx) => {
    const st = ensureCtx(ctx);
    st.input = {
      remainingPercent: 10,
      daysToReset: 2,
      measuredBurnPercentPerDay: 30,
      affordableBurnPercentPerDay: 4,
    };
    st.result = runBudgetShiftGovernor(st.config, st.input);
  });

  scoped(registry, /^the verdict is SKIP$/, (ctx) => {
    if (ctx.bl666.result.verdict !== 'SKIP') {
      throw new Error(`expected SKIP, got ${ctx.bl666.result.verdict}`);
    }
  });

  scoped(registry, /^approvals and Telegram drain at the next swarm start without silent drop$/, (ctx) => {
    if (!ctx.bl666.result.drainsApprovalsAtNextStart) {
      throw new Error('SKIP verdict must drain approvals/Telegram at next start');
    }
  });

  scoped(registry, /^the plan distinguishes prepaid tank from paid credits$/, (ctx) => {
    ensureCtx(ctx).input = {
      remainingPercent: 50,
      daysToReset: 5,
      measuredBurnPercentPerDay: 10,
      affordableBurnPercentPerDay: 8,
      spendPaidCredits: true,
      paidCreditsOptIn: false,
    };
  });

  scoped(registry, /^any verdict would spend paid credits$/, (ctx) => {
    ctx.bl666.input.spendPaidCredits = true;
    ctx.bl666.input.paidCreditsOptIn = false;
  });

  scoped(registry, /^the governor refuses and announces that credits require explicit opt-in$/, (ctx) => {
    const result = runBudgetShiftGovernor(ctx.bl666.config, ctx.bl666.input);
    if (!result.refusedPaidCredits || !/explicit human opt-in/i.test(result.announcement)) {
      throw new Error(`expected credits refusal announcement, got ${result.announcement}`);
    }
  });
}

module.exports = { registerSteps };
