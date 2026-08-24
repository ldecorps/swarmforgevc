'use strict';

// BL-682: step handlers for "Mistral Vibe is reachable through the
// Intelligence Layer". Drives model_factory_lib.bb and
// mistral_vibe_registration_lib.bb through Babashka, and the committed seed
// via seed-data->registry — never a JS reimplementation of either map.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'Mistral Vibe is reachable through the Intelligence Layer';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const FACTORY_LIB = path.join(SCRIPTS, 'model_factory_lib.bb');
const STEWARD_LIB = path.join(SCRIPTS, 'model_steward_lib.bb');
const REG_LIB = path.join(SCRIPTS, 'mistral_vibe_registration_lib.bb');
const SEED = path.join(REPO_ROOT, 'swarmforge', 'model-steward', 'seed', 'models.seed.json');

const UNCHANGED = {
  anthropic: 'claude',
  openai: 'codex',
  cerebras: 'aider',
};

function bb(expr) {
  return execFileSync(
    'bb',
    [
      '-e',
      `(load-file "${STEWARD_LIB}")
       (load-file "${FACTORY_LIB}")
       (load-file "${REG_LIB}")
       ${expr}`,
    ],
    { encoding: 'utf8' }
  ).trim();
}

function agentFor(provider) {
  const out = bb(`(println (pr-str (model-factory-lib/agent-for-provider "${provider}")))`);
  if (out === 'nil') return null;
  return out.replace(/^"|"$/g, '');
}

function resolveLaunch(provider) {
  return bb(`(println (pr-str (model-factory-lib/resolve-launch-agent "${provider}")))`);
}

function seedRegistryPrStr() {
  return bb(`(require '[cheshire.core :as json])
(def seed (json/parse-string (slurp "${SEED}") true))
(println (pr-str (model-steward-lib/seed-data->registry seed)))`);
}

function planFromCfg(edn) {
  return bb(`(println (pr-str (mistral-vibe-registration-lib/registration-from-vibe-config ${edn})))`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the model factory's provider-to-agent map$/, (ctx) => {
    ctx.providerMap = bb('(println (pr-str model-factory-lib/provider->agent))');
  });

  scoped(/^the mistral provider resolves to the vibe agent$/, () => {
    assert.equal(agentFor('mistral'), 'vibe');
  });

  scoped(/^the (.+) provider resolves to the (.+) agent$/, (ctx, provider, agent) => {
    assert.ok(Object.prototype.hasOwnProperty.call(UNCHANGED, provider), `unexpected outline provider ${provider}`);
    assert.equal(UNCHANGED[provider], agent, 'Examples column must match the locked table');
    assert.equal(agentFor(provider), agent);
  });

  scoped(/^a provider with no mapping is resolved$/, (ctx) => {
    ctx.unknownProvider = 'no-such-provider-bl682';
    ctx.unknownResolution = resolveLaunch(ctx.unknownProvider);
  });

  scoped(/^resolution reports the provider as unknown$/, (ctx) => {
    assert.match(ctx.unknownResolution, /:known\? false/);
    assert.match(ctx.unknownResolution, /:agent nil/);
  });

  scoped(/^the Model Steward registry$/, (ctx) => {
    ctx.seedReg = seedRegistryPrStr();
  });

  scoped(/^it lists a model whose provider is mistral$/, (ctx) => {
    assert.match(ctx.seedReg, /:provider "mistral"/);
    assert.match(ctx.seedReg, /:model "mistral-medium-3\.5"/);
  });

  scoped(/^that model carries a cost class$/, (ctx) => {
    assert.match(ctx.seedReg, /:cost_class "medium"/);
  });

  scoped(/^the registered Mistral model id is traceable to the vibe config's active model$/, (ctx) => {
    assert.match(ctx.seedReg, /:model "mistral-medium-3\.5"/);
    assert.match(ctx.seedReg, /:underlying_name "mistral-vibe-cli-latest"/);
    assert.match(ctx.seedReg, /vibe-config/);
  });

  scoped(/^an id the tool could not supply is registered at agent granularity with that reason recorded$/, () => {
    const plan = planFromCfg('nil');
    assert.match(plan, /:agent-granularity\? true/);
    assert.match(plan, /:model "vibe"/);
    assert.match(plan, /:reason "/);
  });

  scoped(/^a vibe config whose active model is an alias of a model named latest$/, (ctx) => {
    ctx.vibeCfgEdn = `{:active_model "mistral-medium-3.5"
                       :models [{:name "mistral-vibe-cli-latest"
                                 :alias "mistral-medium-3.5"
                                 :input_price 1.5
                                 :output_price 7.5
                                 :auto_compact_threshold 200000}]}`;
  });

  scoped(/^the Mistral model is registered$/, (ctx) => {
    if (ctx.vibeCfgEdn) {
      ctx.regPlan = planFromCfg(ctx.vibeCfgEdn);
    } else if (ctx.pricesCfgEdn) {
      ctx.regPlan = planFromCfg(ctx.pricesCfgEdn);
    } else {
      ctx.regPlan = ctx.seedReg || seedRegistryPrStr();
    }
  });

  scoped(/^the registered id is the alias$/, (ctx) => {
    assert.match(ctx.regPlan, /:model "mistral-medium-3\.5"/);
    assert.doesNotMatch(ctx.regPlan, /:model "mistral-vibe-cli-latest"/);
  });

  scoped(/^the underlying model name is recorded on the entry$/, (ctx) => {
    assert.match(ctx.regPlan, /:underlying_name "mistral-vibe-cli-latest"/);
  });

  scoped(/^a vibe config declaring a compaction threshold and token prices$/, (ctx) => {
    ctx.pricesCfgEdn = `{:active_model "mistral-medium-3.5"
                         :models [{:name "mistral-vibe-cli-latest"
                                   :alias "mistral-medium-3.5"
                                   :input_price 1.5
                                   :output_price 7.5
                                   :auto_compact_threshold 200000}]}`;
  });

  scoped(/^its context window is the declared compaction threshold$/, (ctx) => {
    assert.match(ctx.regPlan, /:context_window 200000/);
  });

  scoped(/^its cost class is derived from the declared token prices rather than the session spend cap$/, (ctx) => {
    assert.equal(
      bb('(println (mistral-vibe-registration-lib/cost-class-from-token-prices 1.5 7.5))'),
      'medium'
    );
    assert.match(ctx.regPlan, /:cost_class "medium"/);
  });

  scoped(/^the Model Steward registry before this slice$/, (ctx) => {
    ctx.beforeSnapshot = {
      'anthropic/claude-sonnet-5': { status: 'certified', context_window: 200000, cost_class: 'medium' },
      'openai/gpt-5.3-codex': { status: 'certified', context_window: 128000, cost_class: 'medium' },
      'cerebras/llama-3.3-70b': { status: 'candidate', context_window: 32000, cost_class: 'low' },
      'cursor/auto': { status: 'candidate', context_window: 200000, cost_class: 'medium' },
    };
  });

  scoped(/^every previously registered model keeps its status, context window and cost class$/, (ctx) => {
    const reg = ctx.seedReg || seedRegistryPrStr();
    for (const [key, expected] of Object.entries(ctx.beforeSnapshot)) {
      const [provider, model] = key.split('/');
      const entry = bb(`(require '[cheshire.core :as json])
(def seed (json/parse-string (slurp "${SEED}") true))
(def reg (model-steward-lib/seed-data->registry seed))
(println (pr-str (model-steward-lib/model-entry reg "${provider}" "${model}")))`);
      assert.match(entry, new RegExp(`:status "${expected.status}"`));
      assert.match(entry, new RegExp(`:context_window ${expected.context_window}`));
      assert.match(entry, new RegExp(`:cost_class "${expected.cost_class}"`));
      void reg;
    }
  });
}

module.exports = { registerSteps };
