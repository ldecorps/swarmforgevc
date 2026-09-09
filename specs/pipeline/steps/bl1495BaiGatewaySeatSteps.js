'use strict';

// BL-1495: step handlers for "a b.ai gateway seat resolves, launches,
// survives a respawn and authenticates". Drives the REAL bb libs and CLIs -
// never a reimplementation of the decision:
//   scenario 01 -> pack_staffing_gate_cli.bb over a fixture MODEL_STEWARD_STATE_DIR
//   scenario 02 -> provider_compat_lib.bb's resolve-openai-compat directly
//   scenario 03 -> provider_respawn_env_lib.bb + handoff_lib.bb's two respawn mappings
//   scenario 04 -> harness_env_scrub_lib.bb + its shell twin harness_env_scrub.sh
//   scenario 05 -> pack_staffing_gate_cli.bb over the SHIPPED glm-mono-router.conf

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1495 a b.ai gateway seat resolves, launches, survives a respawn and authenticates';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'pack_staffing_gate_cli.bb');
const PROVIDER_COMPAT_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'provider_compat_lib.bb');
const PROVIDER_RESPAWN_ENV_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'provider_respawn_env_lib.bb');
const HANDOFF_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoff_lib.bb');
const HARNESS_ENV_SCRUB_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'harness_env_scrub_lib.bb');
const HARNESS_ENV_SCRUB_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'harness_env_scrub.sh');
const GLM_PACK = path.join(REPO_ROOT, 'swarmforge', 'packs', 'glm-mono-router.conf');

// The seven `window` lines glm-mono-router.conf ships (BL-243: the
// coordinator is reserved infrastructure, never a window line, and
// pack_staffing_gate's ONE call site never gates it - so this list, and the
// fixture role matrix below, deliberately excludes "coordinator").
const PIPELINE_ROLES_ON_GLM = ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
const ROLE_GATE_OVERRIDES = { hardender: 'hardener-gate' };
function gateCompetency(role) {
  return ROLE_GATE_OVERRIDES[role] || `${role}-gate`;
}

const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


function bbEval(expr) {
  const r = spawnSync('bb', ['-e', expr], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return r.stdout.trim();
}

// Every provider env var a live operator shell may already carry (real
// SWARMFORGE_USE_CEREBRAS=1 + CEREBRAS_API_KEY, etc.) - cleared before
// layering in a scenario's own fixture env, so an ambient higher-precedence
// provider (resolve-openai-compat prefers Cerebras > Perplexity > Qwen >
// b.ai) never silently wins over the b.ai fixture under test.
const PROVIDER_ENV_VARS_TO_ISOLATE = [
  'SWARMFORGE_USE_CEREBRAS', 'CEREBRAS_API_KEY',
  'SWARMFORGE_USE_PERPLEXITY', 'PERPLEXITY_API_KEY',
  'SWARMFORGE_USE_QWEN', 'QWEN_API_KEY', 'BAILIAN_TOKEN_PLAN_API_KEY', 'BAILIAN_CODING_PLAN_API_KEY',
  'SWARMFORGE_USE_BAI', 'B_AI_API_KEY',
  'GEMINI_API_KEY', 'SWARMFORGE_GEMINI_API_KEY',
  'OPENAI_API_KEY', 'OPENAI_API_BASE', 'OPENAI_BASE_URL',
  'MISTRAL_API_KEY', 'OPENROUTER_API_KEY',
];

function bbEvalWithEnv(expr, env) {
  const isolatedEnv = { ...process.env };
  for (const name of PROVIDER_ENV_VARS_TO_ISOLATE) delete isolatedEnv[name];
  const r = spawnSync('bb', ['-e', expr], { encoding: 'utf8', env: { ...isolatedEnv, ...env } });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return r.stdout.trim();
}

// nil for a JS null/undefined, else a Clojure string literal - the only two
// shapes this file's fixtures ever need to splice into a bb -e expression.
function bbLiteral(value) {
  return value === null || value === undefined ? 'nil' : JSON.stringify(value);
}

function buildStateDir() {
  const stateDir = mkSocketFixtureRoot('bl1495-staffing-state-');
  fs.mkdirSync(path.join(stateDir, 'scorecards'), { recursive: true });
  const roleMatrix = {};
  for (const role of PIPELINE_ROLES_ON_GLM) {
    roleMatrix[role] = [
      { provider: 'tencentcloud2', model: 'glm-5.3-flash', score: 0.8, evidence: 'compliance-battery:bl1495-fixture' },
    ];
  }
  roleMatrix.specifier = [
    { provider: 'anthropic', model: 'claude-fable-5-1', score: 0.8, evidence: 'compliance-battery:bl1495-fixture' },
  ];
  const registry = {
    models: {
      'tencentcloud2/glm-5.3-flash': { provider: 'tencentcloud2', model: 'glm-5.3-flash', status: 'certified', certification_report_path: null },
      'anthropic/claude-fable-5-1': { provider: 'anthropic', model: 'claude-fable-5-1', status: 'certified', certification_report_path: null },
    },
    capabilities: {},
    role_matrix: roleMatrix,
    adapters: {},
  };
  fs.writeFileSync(path.join(stateDir, 'registry.json'), JSON.stringify(registry));
  const glmEntries = PIPELINE_ROLES_ON_GLM.map((role) => ({ competency: gateCompetency(role), status: 'pass', reason: 'bl1495-fixture' }));
  fs.writeFileSync(
    path.join(stateDir, 'scorecards', 'tencentcloud2__glm-5.3-flash.json'),
    JSON.stringify({ model: 'glm-5.3-flash', entries: glmEntries }),
  );
  fs.writeFileSync(
    path.join(stateDir, 'scorecards', 'anthropic__claude-fable-5-1.json'),
    JSON.stringify({ model: 'claude-fable-5-1', entries: [{ competency: 'specifier-gate', status: 'pass', reason: 'bl1495-fixture' }] }),
  );
  return stateDir;
}

function gateWindows(stateDir, lines) {
  const wf = path.join(mkSocketFixtureRoot('bl1495-windows-'), 'windows.tsv');
  fs.writeFileSync(wf, lines.join('\n') + '\n');
  const r = spawnSync('bb', [GATE_CLI, REPO_ROOT, wf], {
    encoding: 'utf8',
    env: { ...process.env, MODEL_STEWARD_STATE_DIR: stateDir },
  });
  assert.equal(r.status, 0, `gate CLI failed: ${r.stderr}`);
  return r.stdout
    .trim()
    .split('\n')
    .map((line) => {
      const [seatId, decision, provider, model, failingCheck, stewardCommand] = line.split('\t');
      return { seatId, decision, provider, model, failingCheck, stewardCommand };
    });
}

// `window <role> <agent> <worktree> [task|batch] [extra-cli...]` - the same
// grammar swarmforge.sh's parse_config reads, parsed here without touching
// swarmforge.sh itself (a pure text read of the shipped conf).
function parsePackWindows(confPath) {
  const text = fs.readFileSync(confPath, 'utf8');
  const windows = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('window ')) continue;
    const fields = trimmed.split(/\s+/);
    const [, role, agent, worktree, maybeMode, ...rest] = fields;
    const mode = maybeMode === 'task' || maybeMode === 'batch' ? maybeMode : null;
    const extraCliParts = mode ? rest : [maybeMode, ...rest].filter(Boolean);
    windows.push({ role, agent, worktree, extraCli: extraCliParts.join(' ') });
  }
  return windows;
}

function pairsToMap(flags) {
  const out = {};
  for (let i = 0; i < flags.length; i += 2) {
    if (flags[i] !== '-e') continue;
    const eq = flags[i + 1].indexOf('=');
    out[flags[i + 1].slice(0, eq)] = flags[i + 1].slice(eq + 1);
  }
  return out;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a steward registry fixture where tencentcloud2\/glm-5\.3-flash is certified for every pipeline role and anthropic\/claude-fable-5-1 is certified for the specifier$/,
    (ctx) => {
      ctx.stateDir = buildStateDir();
    },
  );

  // ── scenario 01 ──────────────────────────────────────────────────────────
  scoped(/^a window line for role "([^"]+)" running agent "([^"]+)" with "([^"]*)"$/, (ctx, role, agent, cli) => {
    ctx.seatLine = `seat1\t${role}\t${agent}\t${cli}`;
  });

  scoped(/^the staffing gate evaluates that seat$/, (ctx) => {
    ctx.gateResults = gateWindows(ctx.stateDir, [ctx.seatLine]);
  });

  scoped(/^the seat resolves to steward provider "([^"]+)" and the gate answers "([^"]+)"$/, (ctx, provider, verdict) => {
    const [result] = ctx.gateResults;
    assert.equal(result.provider, provider, `expected provider ${provider}, got: ${JSON.stringify(result)}`);
    assert.equal(result.decision, verdict, `expected decision ${verdict}, got: ${JSON.stringify(result)}`);
  });

  // ── scenario 02 ──────────────────────────────────────────────────────────
  scoped(/^a launch CLI targeting https:\/\/api\.b\.ai\/v1 with B_AI_API_KEY "([^"]*)"$/, (ctx, key) => {
    ctx.launchCli = '--model openai/glm-5.3-flash --openai-api-base https://api.b.ai/v1';
    ctx.baiApiKey = key === 'absent' ? null : key;
  });

  scoped(/^a shell OPENAI_API_KEY of "([^"]*)"$/, (ctx, key) => {
    ctx.shellOpenaiKey = key === 'absent' ? null : key;
  });

  scoped(/^the OpenAI-compatible pane environment is resolved$/, (ctx) => {
    const expr = `
(require '[cheshire.core :as json])
(load-file "${PROVIDER_COMPAT_LIB}")
(println (json/generate-string (provider-compat-lib/resolve-openai-compat
  {:launch-cli ${bbLiteral(ctx.launchCli)}
   :bai-api-key ${bbLiteral(ctx.baiApiKey)}
   :openai-api-key ${bbLiteral(ctx.shellOpenaiKey)}})))`;
    ctx.resolved = JSON.parse(bbEval(expr));
  });

  scoped(
    /^the resolved OPENAI_API_KEY is "([^"]*)", the base is "([^"]*)" and the reason is "([^"]*)"$/,
    (ctx, mappedKey, base, reason) => {
      const expectedKey = mappedKey === 'absent' ? null : mappedKey;
      assert.equal(ctx.resolved['openai-api-key'], expectedKey, `expected OPENAI_API_KEY ${expectedKey}, got: ${JSON.stringify(ctx.resolved)}`);
      assert.equal(ctx.resolved['openai-api-base'], base, `expected base ${base}, got: ${JSON.stringify(ctx.resolved)}`);
      assert.equal(ctx.resolved.reason, reason, `expected reason ${reason}, got: ${JSON.stringify(ctx.resolved)}`);
    },
  );

  // ── scenario 03 ──────────────────────────────────────────────────────────
  scoped(/^SWARMFORGE_USE_BAI is "([^"]*)" and B_AI_API_KEY is "([^"]*)" in the respawning process$/, (ctx, flag, key) => {
    ctx.respawnEnv = { SWARMFORGE_USE_BAI: flag, B_AI_API_KEY: key };
  });

  scoped(
    /^the respawn pane environment is derived for role "([^"]+)" by both respawn mappings$/,
    (ctx, role) => {
      const stateDir = mkSocketFixtureRoot('bl1495-respawn-state-');
      const env = { ...ctx.respawnEnv, OPENAI_API_KEY: ctx.shellOpenaiKey || '' };

      const respawnExpr = `
(require '[cheshire.core :as json])
(load-file "${PROVIDER_RESPAWN_ENV_LIB}")
(println (json/generate-string (provider-respawn-env-lib/provider-respawn-env-args "${stateDir}" "${role}")))`;
      ctx.respawnLibFlags = JSON.parse(bbEvalWithEnv(respawnExpr, env));

      const handoffExpr = `
(require '[cheshire.core :as json])
(load-file "${HANDOFF_LIB}")
(println (json/generate-string (handoff-lib/openrouter-pane-env-args)))`;
      ctx.handoffLibFlags = JSON.parse(bbEvalWithEnv(handoffExpr, env));
    },
  );

  scoped(
    /^each carries OPENAI_API_KEY "([^"]*)" with OPENAI_API_BASE and OPENAI_BASE_URL "([^"]*)"$/,
    (ctx, key, base) => {
      for (const [label, flags] of [['provider_respawn_env_lib.bb', ctx.respawnLibFlags], ['handoff_lib.bb', ctx.handoffLibFlags]]) {
        const map = pairsToMap(flags);
        assert.equal(map.OPENAI_API_KEY, key, `${label}: expected OPENAI_API_KEY ${key}, got: ${JSON.stringify(map)}`);
        assert.equal(map.OPENAI_API_BASE, base, `${label}: expected OPENAI_API_BASE ${base}, got: ${JSON.stringify(map)}`);
        assert.equal(map.OPENAI_BASE_URL, base, `${label}: expected OPENAI_BASE_URL ${base}, got: ${JSON.stringify(map)}`);
      }
    },
  );

  scoped(/^neither carries the shell OPENAI_API_KEY$/, (ctx) => {
    for (const [label, flags] of [['provider_respawn_env_lib.bb', ctx.respawnLibFlags], ['handoff_lib.bb', ctx.handoffLibFlags]]) {
      const map = pairsToMap(flags);
      assert.notEqual(map.OPENAI_API_KEY, ctx.shellOpenaiKey, `${label}: the shell's real OPENAI_API_KEY leaked through: ${JSON.stringify(map)}`);
    }
  });

  // ── scenario 04 ──────────────────────────────────────────────────────────
  scoped(/^the provider scrub map and the aider keep set are read from the bb lib and the shell twin$/, (ctx) => {
    const bbExpr = `
(require '[cheshire.core :as json])
(load-file "${HARNESS_ENV_SCRUB_LIB}")
(println (json/generate-string {:scrub (vec harness-env-scrub-lib/provider-secret-vars)
                                 :aider-keep (vec (get harness-env-scrub-lib/backend-provider-vars "aider"))}))`;
    ctx.bbScrub = JSON.parse(bbEval(bbExpr));

    const shScript = `
source "${HARNESS_ENV_SCRUB_SH}" >/dev/null 2>&1
printf '%s\\n' "\${HARNESS_ENV_PROVIDER_SECRET_VARS[@]}"
echo '---'
harness_env_backend_provider_vars aider`;
    const shResult = spawnSync('bash', ['-c', shScript], { encoding: 'utf8' });
    assert.equal(shResult.status, 0, `shell twin read failed: ${shResult.stderr}`);
    const [scrubPart, aiderPart] = shResult.stdout.split('---\n');
    ctx.shScrub = scrubPart.trim().split('\n').filter(Boolean);
    ctx.shAiderKeep = (aiderPart || '').trim().split('\n').filter(Boolean);
  });

  scoped(/^B_AI_API_KEY is in the scrub map of both$/, (ctx) => {
    assert.ok(ctx.bbScrub.scrub.includes('B_AI_API_KEY'), `bb lib scrub map missing B_AI_API_KEY: ${JSON.stringify(ctx.bbScrub.scrub)}`);
    assert.ok(ctx.shScrub.includes('B_AI_API_KEY'), `shell twin scrub array missing B_AI_API_KEY: ${JSON.stringify(ctx.shScrub)}`);
  });

  scoped(/^B_AI_API_KEY is in the aider keep set of both$/, (ctx) => {
    assert.ok(ctx.bbScrub['aider-keep'].includes('B_AI_API_KEY'), `bb lib aider keep set missing B_AI_API_KEY: ${JSON.stringify(ctx.bbScrub['aider-keep'])}`);
    assert.ok(ctx.shAiderKeep.includes('B_AI_API_KEY'), `shell twin aider keep set missing B_AI_API_KEY: ${JSON.stringify(ctx.shAiderKeep)}`);
  });

  // ── scenario 05 ──────────────────────────────────────────────────────────
  scoped(/^the shipped pack "([^"]+)"$/, (ctx, packName) => {
    const confPath = path.join(REPO_ROOT, 'swarmforge', 'packs', `${packName}.conf`);
    assert.ok(fs.existsSync(confPath), `no such shipped pack: ${confPath}`);
    ctx.packConfPath = confPath;
    ctx.packWindows = parsePackWindows(confPath);
    assert.ok(ctx.packWindows.length > 0, `${confPath} declares no window lines`);
  });

  scoped(/^every window line of the pack is gated under the registry fixture$/, (ctx) => {
    const lines = ctx.packWindows.map((w) => `${w.role}\t${w.role}\t${w.agent}\t${w.extraCli}`);
    ctx.gateResults = gateWindows(ctx.stateDir, lines);
  });

  scoped(/^every window resolves and the gate answers "([^"]+)" for each$/, (ctx, verdict) => {
    for (const result of ctx.gateResults) {
      assert.equal(result.decision, verdict, `seat ${result.seatId} did not answer ${verdict}: ${JSON.stringify(result)}`);
      assert.ok(result.provider, `seat ${result.seatId} resolved no provider: ${JSON.stringify(result)}`);
    }
  });

  scoped(
    /^the specifier window runs "([^"]+)" on "([^"]+)" and every other window runs "([^"]+)" on "([^"]+)" against "([^"]+)"$/,
    (ctx, specifierAgent, specifierModel, otherAgent, otherModel, base) => {
      const specifier = ctx.packWindows.find((w) => w.role === 'specifier');
      assert.ok(specifier, 'pack declares no specifier window');
      assert.equal(specifier.agent, specifierAgent);
      assert.ok(specifier.extraCli.includes(`--model ${specifierModel}`), `specifier window missing --model ${specifierModel}: ${specifier.extraCli}`);

      for (const w of ctx.packWindows) {
        if (w.role === 'specifier') continue;
        assert.equal(w.agent, otherAgent, `window ${w.role} is not agent ${otherAgent}: ${w.agent}`);
        assert.ok(w.extraCli.includes(`--model ${otherModel}`), `window ${w.role} missing --model ${otherModel}: ${w.extraCli}`);
        assert.ok(w.extraCli.includes(`--openai-api-base ${base}`), `window ${w.role} missing --openai-api-base ${base}: ${w.extraCli}`);
      }
    },
  );
}

module.exports = { registerSteps };
