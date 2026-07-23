'use strict';

// BL-547 Slice 1: step handlers for "Model Steward owns model lifecycle
// knowledge and certification for the swarm". Drives the REAL
// model_steward_cli.bb — never re-implements registry/capability/role-matrix
// decisions in JS. Each scenario gets its own isolated state dir via
// MODEL_STEWARD_STATE_DIR (the CLI's test-isolation seam) so acceptance runs
// never mutate this repo's real .swarmforge/model-steward/.
//
// certification-gate-05's Gherkin source has a fourth line ("Unless an
// explicit operator override permits uncertified models") that the vendored
// gherkin-parser drops from the JSON IR because "Unless" is a non-standard
// keyword — only 3 steps reach this registry (confirmed via the generated
// test file). The coder does not own Gherkin authoring/IR, so the override
// behavior it names is covered here as extra assertion coverage inside the
// existing "the candidate model is not recommended" Then handler instead of
// a step of its own.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const MODEL_STEWARD_CLI = path.join(SCRIPTS_DIR, 'model_steward_cli.bb');
const SEED_FILE = path.join(REPO_ROOT, 'swarmforge', 'model-steward', 'seed', 'models.seed.json');

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value is validated against an explicit KNOWN_VALUES lookup, never a bare
// passthrough, so a gherkin-mutator edit into an unrecognized value fails the
// scenario immediately instead of slipping into an else branch.
const KNOWN_STATUSES = new Set(['candidate', 'certified', 'deprecated']);
const KNOWN_ROLES = new Set(['architect', 'coder', 'cleaner', 'QA', 'hardender', 'documenter', 'specifier']);

function cli(stateDir, args) {
  return execFileSync('bb', [MODEL_STEWARD_CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MODEL_STEWARD_STATE_DIR: stateDir }
  });
}

function cliExitCode(stateDir, args) {
  try {
    cli(stateDir, args);
    return 0;
  } catch (err) {
    if (typeof err.status === 'number') return err.status;
    throw err;
  }
}

function showEntry(stateDir, provider, model) {
  return JSON.parse(cli(stateDir, ['show', `${provider}/${model}`]));
}

function statusLines(stateDir) {
  return cli(stateDir, ['status'])
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [providerModel, status] = line.split(' ');
      const slash = providerModel.indexOf('/');
      return { provider: providerModel.slice(0, slash), model: providerModel.slice(slash + 1), status };
    });
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────────
  registry.define(/^the Model Steward registry is initialised$/, (ctx) => {
    ctx.stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl547-model-steward-'));
    // Any CLI call lazily initialises the runtime registry from the
    // committed seed on first read (model_steward_store.bb/read-registry!).
    cli(ctx.stateDir, ['status']);
  });

  registry.define(/^the committed schema seed exists under swarmforge\/model-steward\/$/, () => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(`expected the committed Model Steward seed at ${SEED_FILE}`);
    }
  });

  // ── model-registry-entry-01 (Scenario Outline) ────────────────────────────
  registry.define(/^a model "([^"]+)" from provider "([^"]+)"$/, (ctx, model, provider) => {
    ctx.provider = provider;
    ctx.model = model;
  });

  registry.define(/^the model is registered in the Model Registry$/, (ctx) => {
    // The Background already initialised the registry from the committed
    // seed, which already carries this model — "registered" here means
    // "present with its seeded lifecycle status", not a fresh re-register
    // (a bare `register` would reset status to candidate, which is wrong
    // for the two Examples rows that expect "certified").
    ctx.entry = showEntry(ctx.stateDir, ctx.provider, ctx.model);
  });

  registry.define(/^its status is "([^"]+)"$/, (ctx, status) => {
    if (!KNOWN_STATUSES.has(status)) {
      throw new Error(`unrecognized Examples <status> value: "${status}"`);
    }
    if (ctx.entry.status !== status) {
      throw new Error(`expected status "${status}" for ${ctx.provider}/${ctx.model}, got: ${ctx.entry.status}`);
    }
  });

  registry.define(/^its metadata includes context window and cost class$/, (ctx) => {
    if (ctx.entry.context_window == null) {
      throw new Error(`expected a context_window on ${ctx.provider}/${ctx.model}'s registry entry`);
    }
    if (ctx.entry.cost_class == null) {
      throw new Error(`expected a cost_class on ${ctx.provider}/${ctx.model}'s registry entry`);
    }
  });

  // ── capability-registry-dimensions-02 ─────────────────────────────────────
  registry.define(/^a certified model with completed evaluation$/, (ctx) => {
    // anthropic/claude-sonnet-5 ships certified with a full 5-dimension
    // capability entry in the committed seed.
    ctx.provider = 'anthropic';
    ctx.model = 'claude-sonnet-5';
  });

  registry.define(/^its capability registry entry is read$/, (ctx) => {
    ctx.capability = JSON.parse(cli(ctx.stateDir, ['capability', `${ctx.provider}/${ctx.model}`]));
  });

  registry.define(/^it includes scores or flags for coding quality$/, (ctx) => {
    if (ctx.capability.coding_quality == null) throw new Error('expected a coding_quality capability entry');
  });
  registry.define(/^it includes scores or flags for protocol compliance$/, (ctx) => {
    if (ctx.capability.protocol_compliance == null) throw new Error('expected a protocol_compliance capability entry');
  });
  registry.define(/^it includes scores or flags for tool usage$/, (ctx) => {
    if (ctx.capability.tool_usage == null) throw new Error('expected a tool_usage capability entry');
  });
  registry.define(/^it includes scores or flags for autonomy$/, (ctx) => {
    if (ctx.capability.autonomy == null) throw new Error('expected an autonomy capability entry');
  });
  registry.define(/^it includes scores or flags for cost and latency$/, (ctx) => {
    if (ctx.capability.cost_latency == null) throw new Error('expected a cost_latency capability entry');
  });

  // ── role-recommendation-matrix-03 (Scenario Outline) ──────────────────────
  registry.define(/^certified models exist for role "([^"]+)"$/, (ctx, role) => {
    if (!KNOWN_ROLES.has(role)) {
      throw new Error(`unrecognized Examples <role> value: "${role}"`);
    }
    // The seed's role_matrix already ranks anthropic/claude-sonnet-5
    // (certified) above cerebras/llama-3.3-70b (candidate, higher raw
    // score) for every pipeline role — exercising the certification-gate
    // exclusion this scenario is actually about.
    ctx.role = role;
  });

  registry.define(/^the role recommendation matrix is queried for "([^"]+)"$/, (ctx, role) => {
    if (!KNOWN_ROLES.has(role)) {
      throw new Error(`unrecognized Examples <role> value: "${role}"`);
    }
    const lines = cli(ctx.stateDir, ['role-matrix', role]).trim().split('\n').filter(Boolean);
    ctx.ranked = lines.map((line) => {
      const [providerModel, score, evidence] = line.split(' ');
      const slash = providerModel.indexOf('/');
      return { provider: providerModel.slice(0, slash), model: providerModel.slice(slash + 1), score, evidence };
    });
  });

  registry.define(/^the top recommendation is a certified model$/, (ctx) => {
    if (!ctx.ranked.length) {
      throw new Error(`expected at least one ranked recommendation for role "${ctx.role}"`);
    }
    const top = showEntry(ctx.stateDir, ctx.ranked[0].provider, ctx.ranked[0].model);
    if (top.status !== 'certified') {
      throw new Error(`expected the top recommendation for role "${ctx.role}" to be certified, got: ${top.status}`);
    }
  });

  registry.define(/^each ranked entry includes an evidence pointer$/, (ctx) => {
    if (!ctx.ranked.every((entry) => entry.evidence)) {
      throw new Error(`expected every ranked entry for role "${ctx.role}" to carry an evidence pointer`);
    }
  });

  // ── prompt-adapter-catalogue-04 ────────────────────────────────────────────
  registry.define(/^a certified model "([^"]+)" on provider "([^"]+)"$/, (ctx, model, provider) => {
    ctx.provider = provider;
    ctx.model = model;
  });

  registry.define(/^the prompt adapter catalogue is queried$/, (ctx) => {
    const out = cli(ctx.stateDir, ['adapter', `${ctx.provider}/${ctx.model}`]).trim();
    const [adapterId, productionDefaultFlag] = out.split(' ');
    ctx.adapterId = adapterId;
    ctx.productionDefault = productionDefaultFlag === 'production_default=true';
  });

  registry.define(/^it returns PromptEngine adapter id "([^"]+)"$/, (ctx, adapterId) => {
    if (ctx.adapterId !== adapterId) {
      throw new Error(`expected adapter id "${adapterId}", got: ${ctx.adapterId}`);
    }
  });

  registry.define(/^uncertified candidate models may list candidate adapters but not production defaults$/, (ctx) => {
    const candidateOut = cli(ctx.stateDir, ['adapter', 'cerebras/llama-3.3-70b']).trim();
    if (!candidateOut.startsWith('generic ')) {
      throw new Error(`expected the seeded candidate model to still have an adapter entry, got: ${candidateOut}`);
    }
    if (!candidateOut.includes('production_default=false')) {
      throw new Error(`expected the candidate model's adapter entry to not be a production default, got: ${candidateOut}`);
    }
  });

  // ── certification-gate-05 ──────────────────────────────────────────────────
  registry.define(/^a model with status "candidate"$/, (ctx) => {
    // cerebras/llama-3.3-70b ships candidate in the committed seed.
    ctx.provider = 'cerebras';
    ctx.model = 'llama-3.3-70b';
  });

  registry.define(/^ModelFactory requests a production assignment for any role$/, (ctx) => {
    ctx.eligibleExitCode = cliExitCode(ctx.stateDir, [
      'eligible', `${ctx.provider}/${ctx.model}`, '--role', 'coder'
    ]);
  });

  registry.define(/^the candidate model is not recommended$/, (ctx) => {
    if (ctx.eligibleExitCode === 0) {
      throw new Error(`expected a non-certified model to be ineligible for production assignment by default`);
    }
    // The Gherkin source's "Unless an explicit operator override permits
    // uncertified models" line is dropped from the parsed IR (see file
    // header), so its behavior is asserted here instead: the same model
    // becomes eligible only with an explicit override.
    const overrideExitCode = cliExitCode(ctx.stateDir, [
      'eligible', `${ctx.provider}/${ctx.model}`, '--role', 'coder', '--override-uncertified'
    ]);
    if (overrideExitCode !== 0) {
      throw new Error('expected an explicit operator override to permit an uncertified model');
    }
  });

  // ── certification-records-report-06 ───────────────────────────────────────
  registry.define(/^a candidate model that passed all certification gates$/, (ctx) => {
    ctx.provider = 'bl547test';
    ctx.model = 'candidate-model';
    cli(ctx.stateDir, ['register', `${ctx.provider}/${ctx.model}`, '--status', 'candidate']);
  });

  registry.define(/^an operator certifies the model$/, (ctx) => {
    const out = cli(ctx.stateDir, ['certify', `${ctx.provider}/${ctx.model}`]).trim();
    const match = out.match(/\(([^)]+)\)$/);
    if (!match) {
      throw new Error(`expected certify output to carry a report path in parentheses, got: ${out}`);
    }
    ctx.reportPath = match[1];
  });

  registry.define(/^its registry status becomes "certified"$/, (ctx) => {
    const entry = statusLines(ctx.stateDir).find((e) => e.provider === ctx.provider && e.model === ctx.model);
    if (!entry || entry.status !== 'certified') {
      throw new Error(`expected ${ctx.provider}/${ctx.model} to be certified, got: ${entry && entry.status}`);
    }
  });

  registry.define(/^a certification report artifact path is recorded$/, (ctx) => {
    const entry = showEntry(ctx.stateDir, ctx.provider, ctx.model);
    if (entry.certification_report_path !== ctx.reportPath) {
      throw new Error('expected the registry entry to record the certify report path from the CLI output');
    }
    if (!fs.existsSync(path.join(ctx.stateDir, ctx.reportPath))) {
      throw new Error(`expected the certification report artifact to exist at ${ctx.reportPath}`);
    }
  });

  // ── decertify-on-regression-07 ─────────────────────────────────────────────
  registry.define(/^a certified model with a prior certification report$/, (ctx) => {
    ctx.provider = 'bl547test';
    ctx.model = 'regressing-model';
    cli(ctx.stateDir, ['register', `${ctx.provider}/${ctx.model}`, '--status', 'candidate']);
    cli(ctx.stateDir, ['certify', `${ctx.provider}/${ctx.model}`]);
  });

  registry.define(/^a re-evaluation shows regression below the certification floor$/, (ctx) => {
    ctx.regressionReason = 'coding_quality regressed below floor';
    const out = cli(ctx.stateDir, [
      'decertify', `${ctx.provider}/${ctx.model}`, '--reason', ctx.regressionReason
    ]).trim();
    const match = out.match(/report=(.+)$/);
    if (!match) {
      throw new Error(`expected decertify output to carry a report= path, got: ${out}`);
    }
    ctx.reportPath = match[1];
  });

  registry.define(/^its registry status becomes "deprecated" or "candidate"$/, (ctx) => {
    const entry = statusLines(ctx.stateDir).find((e) => e.provider === ctx.provider && e.model === ctx.model);
    if (!entry || !['deprecated', 'candidate'].includes(entry.status)) {
      throw new Error(`expected ${ctx.provider}/${ctx.model} to move to deprecated or candidate, got: ${entry && entry.status}`);
    }
  });

  registry.define(/^the certification report records the regression reason$/, (ctx) => {
    const report = JSON.parse(fs.readFileSync(path.join(ctx.stateDir, ctx.reportPath), 'utf8'));
    if (report.reason !== ctx.regressionReason) {
      throw new Error(`expected the regression report to record reason "${ctx.regressionReason}", got: ${report.reason}`);
    }
    if (report.provider !== ctx.provider || report.model !== ctx.model) {
      throw new Error('expected the regression report to name its provider/model directly');
    }
  });
}

module.exports = { registerSteps };
