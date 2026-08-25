'use strict';

// BL-1053: step handlers for "the intelligence layer can route work to a
// local-model seat".
//
// Every step drives the REAL artifacts - model_factory_lib.bb's own
// provider->agent resolution through Babashka, and the model_steward_cli.bb
// / model_factory_cli.bb binaries against throwaway state directories. No
// step re-implements the provider map in JS; one that did would keep passing
// after the map it describes had been emptied.
//
// Scenario 06's seat is given a real assignment overlay rather than left with
// none. With no overlay the pack model passes straight through, so "the seat
// is still on its launched model" would hold for a registration that had
// rewritten the overlay outright - the case the scenario exists to exclude.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const MODEL_FACTORY_LIB = path.join(SCRIPTS_DIR, 'model_factory_lib.bb');
const MODEL_STEWARD_LIB = path.join(SCRIPTS_DIR, 'model_steward_lib.bb');
const MODEL_STEWARD_CLI = path.join(SCRIPTS_DIR, 'model_steward_cli.bb');
const MODEL_FACTORY_CLI = path.join(SCRIPTS_DIR, 'model_factory_cli.bb');

// BL-421 Scenario Outline rule: every Examples: column value is checked
// against an explicit lookup rather than passed through.
const UNCHANGED_PROVIDER_AGENTS = {
  anthropic: 'claude',
  openai: 'codex',
  cerebras: 'aider'
};

const FEATURE = 'The intelligence layer can route work to a local-model seat';

const LOCAL_MODEL_AGENT = 'local-model';
const LOCAL_PROVIDER = 'local';
const KNOWN_COST_CLASSES = new Set(['low', 'medium', 'high']);

const SEAT_LAUNCHED_MODEL = 'claude-sonnet-5';
const SEAT_PACK_MODEL = 'pack-default-model';

function resolveLaunchAgent(provider) {
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(load-file "${MODEL_STEWARD_LIB}")
       (load-file "${MODEL_FACTORY_LIB}")
       (println (pr-str (model-factory-lib/resolve-launch-agent "${provider}")))`
    ],
    { encoding: 'utf8' }
  );
  const text = out.trim();
  return {
    text,
    agent: /:agent nil/.test(text) ? null : (text.match(/:agent "([^"]+)"/) || [])[1] || null,
    known: /:known\? true/.test(text)
  };
}

function snapshotProviderMap() {
  return execFileSync(
    'bb',
    [
      '-e',
      `(load-file "${MODEL_STEWARD_LIB}")
       (load-file "${MODEL_FACTORY_LIB}")
       (println (pr-str model-factory-lib/provider->agent))`
    ],
    { encoding: 'utf8' }
  ).trim();
}

function stewardCli(ctx, args) {
  return execFileSync('bb', [MODEL_STEWARD_CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MODEL_STEWARD_STATE_DIR: ctx.stewardStateDir }
  });
}

function factoryCli(ctx, args) {
  return execFileSync('bb', [MODEL_FACTORY_CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MODEL_STEWARD_STATE_DIR: ctx.stewardStateDir,
      MODEL_FACTORY_STATE_DIR: ctx.factoryStateDir
    }
  });
}

// BL-971: fixture roots swept on exit, not only after the last assertion.
const FIXTURE_ROOTS = [];
let sweepInstalled = false;

function sweepFixtureRoots() {
  while (FIXTURE_ROOTS.length) {
    fs.rmSync(FIXTURE_ROOTS.pop(), { recursive: true, force: true });
  }
}

function ensureStateDirs(ctx) {
  if (!sweepInstalled) {
    process.on('exit', sweepFixtureRoots);
    sweepInstalled = true;
  }
  if (!ctx.stewardStateDir) {
    ctx.stewardStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1053-steward-'));
    ctx.factoryStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1053-factory-'));
    FIXTURE_ROOTS.push(ctx.stewardStateDir, ctx.factoryStateDir);
  }
}

function registerLocalCandidate(ctx, model, costClass) {
  assert.ok(KNOWN_COST_CLASSES.has(costClass), `unknown cost class "${costClass}"`);
  ensureStateDirs(ctx);
  ctx.registeredModel = model;
  stewardCli(ctx, [
    'register',
    `${LOCAL_PROVIDER}/${model}`,
    '--status',
    'candidate',
    '--cost-class',
    costClass
  ]);
}

function registerSteps(registry) {
  const define = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── local-provider-routing-01 / 02 / 03 ─────────────────────────────────
  define(/^the launch agent for provider "([^"]+)" is resolved$/, (ctx, provider) => {
    ctx.provider = provider;
    ctx.resolution = resolveLaunchAgent(provider);
  });

  define(/^it is the local-model seat agent$/, (ctx) => {
    assert.equal(
      ctx.resolution.agent,
      LOCAL_MODEL_AGENT,
      `expected provider "${ctx.provider}" to resolve to the local-model seat agent; got ${ctx.resolution.text}`
    );
    const launcher = fs.readFileSync(path.join(SCRIPTS_DIR, 'swarmforge.sh'), 'utf8');
    assert.match(
      launcher,
      new RegExp(`\\|${LOCAL_MODEL_AGENT}\\)|${LOCAL_MODEL_AGENT}\\)`),
      `swarmforge.sh's agent allow-list does not accept "${LOCAL_MODEL_AGENT}"`
    );
  });

  // Scoped: an unscoped "it is \"...\"" would collide with other features.
  define(/^it is "([^"]+)"$/, (ctx, agent) => {
    const expected = UNCHANGED_PROVIDER_AGENTS[ctx.provider];
    assert.ok(
      expected !== undefined,
      `unknown provider "${ctx.provider}" in the unchanged-providers table`
    );
    assert.equal(
      agent,
      expected,
      `the Examples table pairs provider "${ctx.provider}" with "${agent}", but its registered agent is "${expected}"`
    );
    assert.equal(
      ctx.resolution.agent,
      expected,
      `provider "${ctx.provider}" no longer resolves to "${expected}"; got ${ctx.resolution.text}`
    );
  });

  define(/^the resolution reports the provider as unknown$/, (ctx) => {
    assert.equal(
      ctx.resolution.known,
      false,
      `expected provider "${ctx.provider}" to be reported unknown; got ${ctx.resolution.text}`
    );
    assert.match(
      ctx.resolution.text,
      new RegExp(ctx.provider),
      'the unknown-provider report must name the provider it could not resolve'
    );
  });

  define(/^it names no launch agent$/, (ctx) => {
    assert.equal(
      ctx.resolution.agent,
      null,
      `an unknown provider must name no launch agent; got ${ctx.resolution.text}`
    );
  });

  // ── local-provider-routing-04 / 05 ──────────────────────────────────────
  define(/^"([^"]+)" is registered as a candidate with cost class "([^"]+)"$/, (ctx, model, costClass) => {
    registerLocalCandidate(ctx, model, costClass);
  });

  define(/^"([^"]+)" is registered under provider "([^"]+)"$/, (ctx, model, provider) => {
    assert.equal(
      provider,
      LOCAL_PROVIDER,
      `this feature only registers under provider "${LOCAL_PROVIDER}"; got "${provider}"`
    );
    ensureStateDirs(ctx);
    ctx.providerMapBefore = snapshotProviderMap();
    registerLocalCandidate(ctx, model, 'low');
  });

  define(/^the registry holds it under provider "([^"]+)"$/, (ctx, provider) => {
    const entry = JSON.parse(stewardCli(ctx, ['show', `${provider}/${ctx.registeredModel}`]));
    assert.equal(entry.provider, provider, `expected the entry to be held under provider "${provider}"`);
    assert.equal(entry.model, ctx.registeredModel);
    ctx.registryEntry = entry;
    let underOpenai = null;
    try {
      underOpenai = stewardCli(ctx, ['show', `openai/${ctx.registeredModel}`]);
    } catch {
      underOpenai = null;
    }
    assert.ok(
      !underOpenai || !underOpenai.trim(),
      `${ctx.registeredModel} is also registered under provider "openai", which resolves to the codex CLI`
    );
  });

  define(/^its cost class is "([^"]+)"$/, (ctx, costClass) => {
    assert.ok(KNOWN_COST_CLASSES.has(costClass), `unknown cost class "${costClass}"`);
    assert.equal(
      ctx.registryEntry.cost_class,
      costClass,
      `expected cost class "${costClass}" on the stored entry`
    );
  });

  define(/^the provider to agent map is unchanged$/, (ctx) => {
    assert.ok(ctx.providerMapBefore, 'expected a provider->agent snapshot from the Given');
    assert.equal(
      snapshotProviderMap(),
      ctx.providerMapBefore,
      'registering a second downloaded model edited provider->agent — adding a model must be Steward registration only'
    );
    assert.match(
      ctx.providerMapBefore,
      /"local" "local-model"/,
      'the snapshot must still carry the local -> local-model entry'
    );
  });

  // ── local-provider-routing-06 ───────────────────────────────────────────
  define(/^a role seat is running on its launched model$/, (ctx) => {
    ensureStateDirs(ctx);
    fs.writeFileSync(
      path.join(ctx.factoryStateDir, 'assignment.json'),
      JSON.stringify({
        coder: {
          role: 'coder',
          agent: 'claude',
          provider: 'anthropic',
          model: SEAT_LAUNCHED_MODEL
        }
      })
    );
    ctx.seatModelBefore = factoryCli(ctx, ['resolve-model', 'coder', SEAT_PACK_MODEL]).trim();
    ctx.overlayBefore = fs.readFileSync(path.join(ctx.factoryStateDir, 'assignment.json'), 'utf8');
    assert.equal(
      ctx.seatModelBefore,
      SEAT_LAUNCHED_MODEL,
      'the fixture seat is not running on the model its overlay assigned'
    );
  });

  define(/^that seat is still running on its launched model$/, (ctx) => {
    const after = factoryCli(ctx, ['resolve-model', 'coder', SEAT_PACK_MODEL]).trim();
    assert.equal(
      after,
      ctx.seatModelBefore,
      'registering a model changed what a running seat resolves to'
    );
    assert.equal(
      fs.readFileSync(path.join(ctx.factoryStateDir, 'assignment.json'), 'utf8'),
      ctx.overlayBefore,
      'registering a model rewrote the assignment overlay a running seat reads'
    );
  });
}

module.exports = { registerSteps };
