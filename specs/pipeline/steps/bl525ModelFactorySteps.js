'use strict';

// BL-525 Slice 1: step handlers for "ModelFactory assigns recruiter-backed,
// steward-certified models to swarm roles under a cheap-or-quality steering
// policy". Drives the REAL model_factory_cli.bb (which itself consumes
// model_steward_cli.bb's read API) — never re-implements the steering rules
// or certification gate in JS. Scenarios that need a specific certified/
// candidate/cost-class shape build an isolated Model Steward registry
// fixture directly (mirrors test_model_factory_cli.sh's technique:
// model_steward_store.bb's read-registry! loads an existing registry.json
// verbatim, skipping the seed transform, when one is already present) so
// acceptance never depends on — or mutates — this repo's real
// .swarmforge/model-steward/ or .swarmforge/model-factory/.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const MODEL_FACTORY_CLI = path.join(SCRIPTS_DIR, 'model_factory_cli.bb');

const KNOWN_MODES = new Set(['cheap', 'quality']);
const KNOWN_STATUSES = new Set(['candidate', 'certified', 'deprecated']);
const KNOWN_ROLES = new Set(['architect', 'coder', 'cleaner', 'QA', 'hardender', 'documenter', 'specifier']);

// A stable per-provider model name for fixtures — matches the committed
// swarmforge/model-steward/seed/models.seed.json and model_factory_lib.bb's
// provider->agent map, so fixture entries look like real registry rows.
const MODEL_FOR_PROVIDER = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5.3-codex',
  cerebras: 'llama-3.3-70b'
};

function modelForProvider(provider) {
  return MODEL_FOR_PROVIDER[provider] || `${provider}-model`;
}

function cli(ctx, args) {
  return execFileSync('bb', [MODEL_FACTORY_CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MODEL_STEWARD_STATE_DIR: ctx.stewardStateDir,
      MODEL_FACTORY_STATE_DIR: ctx.factoryStateDir
    }
  });
}

// Scenarios 2-7 each need a Model Steward registry shaped exactly for their
// scenario (specific cost classes / certification statuses / role-matrix
// rankings) that the committed seed does not provide. Building one is
// incremental across a scenario's Given lines, so state accumulates on ctx
// and is re-persisted after every addition.
function ensureFixtureRegistry(ctx) {
  if (!ctx.fixtureModels) {
    ctx.stewardStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl525-model-factory-steward-'));
    ctx.fixtureModels = {};
    ctx.fixtureRoleMatrix = {};
  }
}

function persistFixtureRegistry(ctx) {
  const registry = {
    models: ctx.fixtureModels,
    capabilities: {},
    role_matrix: ctx.fixtureRoleMatrix,
    adapters: {}
  };
  fs.writeFileSync(path.join(ctx.stewardStateDir, 'registry.json'), JSON.stringify(registry));
}

function addFixtureModel(ctx, provider, model, status, costClass) {
  ensureFixtureRegistry(ctx);
  ctx.fixtureModels[`${provider}/${model}`] = {
    provider, model, status, cost_class: costClass, certification_report_path: null
  };
  persistFixtureRegistry(ctx);
}

function addFixtureRanking(ctx, role, provider, model, score) {
  ensureFixtureRegistry(ctx);
  ctx.fixtureRoleMatrix[role] = ctx.fixtureRoleMatrix[role] || [];
  ctx.fixtureRoleMatrix[role].push({ provider, model, score, evidence: 'fixture' });
  persistFixtureRegistry(ctx);
}

function resolveAssignment(ctx, role, mode, { override } = {}) {
  if (!KNOWN_MODES.has(mode)) throw new Error(`unrecognized steering mode: "${mode}"`);
  if (!KNOWN_ROLES.has(role)) throw new Error(`unrecognized swarm role: "${role}"`);
  const args = ['assign', '--mode', mode, '--role', role];
  if (override) args.push('--override-uncertified');
  if (ctx.today) args.push('--today', ctx.today);
  return JSON.parse(cli(ctx, args));
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────────
  registry.define(/^the Model Steward registry is initialised with certified and candidate models$/, (ctx) => {
    ctx.stewardStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl525-model-factory-steward-'));
  });

  registry.define(/^ModelFactory reads the role matrix, certification status, and provider quota signals$/, (ctx) => {
    ctx.factoryStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl525-model-factory-state-'));
    // Any real assign call lazily initialises both the steward registry (from
    // its committed seed) and the factory quota-state (from its own seed),
    // proving the module boundary end to end rather than merely asserting
    // files exist.
    cli(ctx, ['assign', '--mode', 'quality']);
  });

  // ── assign-returns-role-map-01 ────────────────────────────────────────────
  registry.define(/^ModelFactory resolves a full-swarm assignment in "([^"]+)" mode$/, (ctx, mode) => {
    if (!KNOWN_MODES.has(mode)) throw new Error(`unrecognized steering mode: "${mode}"`);
    ctx.mode = mode;
    ctx.assignment = JSON.parse(cli(ctx, ['assign', '--mode', mode]));
  });

  registry.define(/^it returns one assignment per swarm role$/, (ctx) => {
    const roles = Object.keys(ctx.assignment);
    if (roles.length !== KNOWN_ROLES.size || !roles.every((r) => KNOWN_ROLES.has(r))) {
      throw new Error(`expected one assignment per swarm role, got: ${roles.join(', ')}`);
    }
  });

  registry.define(/^each assignment names an agent, a provider, and a model$/, (ctx) => {
    for (const [role, entry] of Object.entries(ctx.assignment)) {
      if (!entry.agent || !entry.provider || !entry.model) {
        throw new Error(`expected role "${role}" to name an agent, provider, and model, got: ${JSON.stringify(entry)}`);
      }
    }
  });

  registry.define(/^each assignment records the steering policy and a rationale$/, (ctx) => {
    for (const [role, entry] of Object.entries(ctx.assignment)) {
      if (entry.policy !== ctx.mode || !entry.reason) {
        throw new Error(`expected role "${role}" to record policy "${ctx.mode}" and a rationale, got: ${JSON.stringify(entry)}`);
      }
    }
  });

  // ── quality-mode-top-certified-02 ─────────────────────────────────────────
  registry.define(/^role "([^"]+)" has a top-ranked certified model and a cheaper compliant certified model$/, (ctx, role) => {
    ctx.role = role;
    ctx.topProvider = 'anthropic';
    ctx.topModel = modelForProvider(ctx.topProvider);
    ctx.cheapProvider = 'openai';
    ctx.cheapModel = modelForProvider(ctx.cheapProvider);
    addFixtureModel(ctx, ctx.topProvider, ctx.topModel, 'certified', 'high');
    addFixtureModel(ctx, ctx.cheapProvider, ctx.cheapModel, 'certified', 'low');
    addFixtureRanking(ctx, role, ctx.topProvider, ctx.topModel, 0.95);
    addFixtureRanking(ctx, role, ctx.cheapProvider, ctx.cheapModel, 0.6);
  });

  registry.define(/^the assigned model is the top-ranked certified model for the role$/, (ctx) => {
    if (ctx.assignment.provider !== ctx.topProvider || ctx.assignment.model !== ctx.topModel) {
      throw new Error(`expected the top-ranked certified model ${ctx.topProvider}/${ctx.topModel}, got: ${ctx.assignment.provider}/${ctx.assignment.model}`);
    }
  });

  // ── cheap-mode-lowest-cost-eligible-03 ────────────────────────────────────
  registry.define(/^role "([^"]+)" has eligible certified models of cost class "([^"]+)" and "([^"]+)"$/, (ctx, role, lowClass, highClass) => {
    ctx.role = role;
    ctx.lowCostProvider = 'openai';
    ctx.lowCostModel = modelForProvider(ctx.lowCostProvider);
    ctx.higherCostProvider = 'anthropic';
    ctx.higherCostModel = modelForProvider(ctx.higherCostProvider);
    addFixtureModel(ctx, ctx.lowCostProvider, ctx.lowCostModel, 'certified', lowClass);
    addFixtureModel(ctx, ctx.higherCostProvider, ctx.higherCostModel, 'certified', highClass);
    addFixtureRanking(ctx, role, ctx.higherCostProvider, ctx.higherCostModel, 0.95);
    addFixtureRanking(ctx, role, ctx.lowCostProvider, ctx.lowCostModel, 0.6);
  });

  registry.define(/^the assigned model is the cost class "([^"]+)" certified model$/, (ctx, costClass) => {
    if (costClass !== 'low') throw new Error(`unexpected cost class in Then step: "${costClass}"`);
    if (ctx.assignment.provider !== ctx.lowCostProvider || ctx.assignment.model !== ctx.lowCostModel) {
      throw new Error(`expected the cost class "low" certified model ${ctx.lowCostProvider}/${ctx.lowCostModel}, got: ${ctx.assignment.provider}/${ctx.assignment.model}`);
    }
  });

  // ── certification-gate-holds-04 / uncertified-override-05 ────────────────
  registry.define(/^the only lowest-cost model for role "([^"]+)" has status "([^"]+)"$/, (ctx, role, status) => {
    if (!KNOWN_STATUSES.has(status)) throw new Error(`unrecognized status: "${status}"`);
    ctx.role = role;
    ctx.candidateProvider = 'cerebras';
    ctx.candidateModel = modelForProvider(ctx.candidateProvider);
    ctx.fallbackProvider = 'openai';
    ctx.fallbackModel = modelForProvider(ctx.fallbackProvider);
    addFixtureModel(ctx, ctx.candidateProvider, ctx.candidateModel, status, 'low');
    addFixtureModel(ctx, ctx.fallbackProvider, ctx.fallbackModel, 'certified', 'medium');
    addFixtureRanking(ctx, role, ctx.candidateProvider, ctx.candidateModel, 0.99);
    addFixtureRanking(ctx, role, ctx.fallbackProvider, ctx.fallbackModel, 0.6);
  });

  registry.define(/^ModelFactory resolves the assignment for role "([^"]+)" in "([^"]+)" mode$/, (ctx, role, mode) => {
    ctx.assignment = resolveAssignment(ctx, role, mode);
  });

  registry.define(/^ModelFactory resolves the assignment for role "([^"]+)" in "([^"]+)" mode with an uncertified override$/, (ctx, role, mode) => {
    ctx.assignment = resolveAssignment(ctx, role, mode, { override: true });
  });

  registry.define(/^the candidate model is not assigned$/, (ctx) => {
    if (ctx.assignment.provider === ctx.candidateProvider && ctx.assignment.model === ctx.candidateModel) {
      throw new Error(`expected the candidate model ${ctx.candidateProvider}/${ctx.candidateModel} to not be assigned`);
    }
  });

  registry.define(/^a certified model is assigned instead$/, (ctx) => {
    if (ctx.assignment.provider !== ctx.fallbackProvider || ctx.assignment.model !== ctx.fallbackModel) {
      throw new Error(`expected the certified fallback ${ctx.fallbackProvider}/${ctx.fallbackModel}, got: ${ctx.assignment.provider}/${ctx.assignment.model}`);
    }
  });

  registry.define(/^the candidate model is assigned$/, (ctx) => {
    if (ctx.assignment.provider !== ctx.candidateProvider || ctx.assignment.model !== ctx.candidateModel) {
      throw new Error(`expected the uncertified candidate ${ctx.candidateProvider}/${ctx.candidateModel} to be assigned with an override, got: ${ctx.assignment.provider}/${ctx.assignment.model}`);
    }
  });

  registry.define(/^the rationale records that an uncertified override was used$/, (ctx) => {
    if (!ctx.assignment.reason || !ctx.assignment.reason.includes('uncertified override')) {
      throw new Error(`expected the rationale to record the uncertified override, got: ${ctx.assignment.reason}`);
    }
  });

  // ── daily-cap-failover-06 / daily-cap-resets-next-day-07 ─────────────────
  registry.define(/^provider "([^"]+)" is eligible for role "([^"]+)" but its free-daily quota is exhausted for today$/, (ctx, provider, role) => {
    ctx.role = role;
    ctx.today = '2026-07-22';
    ctx.exhaustedProvider = provider;
    const model = modelForProvider(provider);
    addFixtureModel(ctx, provider, model, 'certified', 'low');
    addFixtureRanking(ctx, role, provider, model, 0.99);
    cli(ctx, ['mark-exhausted', provider, '--date', ctx.today]);
  });

  registry.define(/^provider "([^"]+)" is an eligible certified fallback for role "([^"]+)"$/, (ctx, provider, role) => {
    ctx.fallbackProvider = provider;
    const model = modelForProvider(provider);
    addFixtureModel(ctx, provider, model, 'certified', 'medium');
    addFixtureRanking(ctx, role, provider, model, 0.6);
  });

  registry.define(/^provider "([^"]+)" was exhausted yesterday and its free-daily quota has reset today$/, (ctx, provider) => {
    ctx.role = 'coder';
    ctx.yesterday = '2026-07-21';
    ctx.today = '2026-07-22';
    ctx.resetProvider = provider;
    const model = modelForProvider(provider);
    addFixtureModel(ctx, provider, model, 'certified', 'low');
    addFixtureRanking(ctx, ctx.role, provider, model, 0.99);
    cli(ctx, ['mark-exhausted', provider, '--date', ctx.yesterday]);
  });

  registry.define(/^provider "([^"]+)" is not assigned for that role$/, (ctx, provider) => {
    if (ctx.assignment.provider === provider) {
      throw new Error(`expected provider "${provider}" to be excluded from the assignment, got: ${JSON.stringify(ctx.assignment)}`);
    }
  });

  registry.define(/^provider "([^"]+)" is assigned before any OpenRouter or Claude paid model$/, (ctx, provider) => {
    if (ctx.assignment.provider !== provider) {
      throw new Error(`expected provider "${provider}" to be assigned as the daily-cap fallback, got: ${ctx.assignment.provider}`);
    }
  });

  registry.define(/^provider "([^"]+)" is assigned for that role again$/, (ctx, provider) => {
    if (ctx.assignment.provider !== provider) {
      throw new Error(`expected provider "${provider}" to be preferred again after its quota reset, got: ${ctx.assignment.provider}`);
    }
  });

  // ── cold-apply-plan-08 ─────────────────────────────────────────────────
  registry.define(/^ModelFactory has resolved a full-swarm assignment$/, (ctx) => {
    ctx.assignment = JSON.parse(cli(ctx, ['assign', '--mode', 'quality']));
  });

  registry.define(/^the cold apply helper is invoked with a stubbed launch seam$/, (ctx) => {
    const seamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl525-model-factory-seam-'));
    ctx.stubSeamPath = path.join(seamDir, 'stub-seam.sh');
    ctx.stubInvocationLog = path.join(seamDir, 'invocation.log');
    fs.writeFileSync(
      ctx.stubSeamPath,
      `#!/usr/bin/env bash\nprintf '%s' "$1" > "${ctx.stubInvocationLog}"\nexit 0\n`
    );
    fs.chmodSync(ctx.stubSeamPath, 0o755);
    ctx.pack = 'codex-mono-router';
    ctx.coldApplyOut = JSON.parse(cli(ctx, ['cold-apply', '--mode', 'quality', '--pack', ctx.pack, '--launch-seam', ctx.stubSeamPath]));
  });

  registry.define(/^a resolved assignment overlay is written under the model-factory state dir$/, (ctx) => {
    const overlayPath = path.join(ctx.factoryStateDir, 'assignment.json');
    if (!fs.existsSync(overlayPath)) {
      throw new Error(`expected the assignment overlay to be written at ${overlayPath}`);
    }
    if (ctx.coldApplyOut.plan.overlay_path !== overlayPath) {
      throw new Error(`expected the plan to name the written overlay path, got: ${ctx.coldApplyOut.plan.overlay_path}`);
    }
  });

  registry.define(/^the plan stops the running swarm and relaunches it against that overlay$/, (ctx) => {
    if (!fs.existsSync(ctx.stubInvocationLog)) {
      throw new Error('expected the stubbed launch seam to have been invoked');
    }
    const invokedPlan = JSON.parse(fs.readFileSync(ctx.stubInvocationLog, 'utf8'));
    if (invokedPlan.stop.script !== 'kill_all_swarm.sh') {
      throw new Error(`expected the plan's stop step to run kill_all_swarm.sh, got: ${JSON.stringify(invokedPlan.stop)}`);
    }
    if (invokedPlan.relaunch.script !== 'swarm' || !invokedPlan.relaunch.args.includes(ctx.pack)) {
      throw new Error(`expected the plan's relaunch step to target pack "${ctx.pack}", got: ${JSON.stringify(invokedPlan.relaunch)}`);
    }
  });
}

module.exports = { registerSteps };
