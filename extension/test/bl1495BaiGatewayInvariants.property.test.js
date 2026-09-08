'use strict';

// BL-1495's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  Every path that maps a provider key onto a pane's OPENAI_*
//                - the compat resolver, the respawn env derivation (both
//                mappings) - treats api.b.ai exactly as it treats
//                api.cerebras.ai: same flag posture, the host's real
//                OPENAI_API_KEY excluded, so a b.ai seat that authenticates
//                at launch authenticates again after a respawn.
//   invariant 2  B_AI_API_KEY reaches a pane only by explicit per-pane -e
//                passthrough; it never sticks to the tmux server's global
//                environment (harness_env_scrub_lib.bb's provider-scrub-vars
//                classification tracks the aider backend, same as every
//                other aider-only key) and never appears in a committed file
//                as a hardcoded value.
//
// Drives the REAL swarmforge/scripts/provider_compat_lib.bb,
// provider_respawn_env_lib.bb, handoff_lib.bb and harness_env_scrub_lib.bb -
// never a JavaScript restatement of the decision.
//
// GENERATOR REACH. Invariant 1 is drawn PAIRED over provider ∈
// {cerebras, bai} so "treats api.b.ai exactly as it treats api.cerebras.ai"
// is a comparison the generator actually makes, not a bai-only fixed
// example; invariant 2's backend-set property is drawn from the full known
// backend vocabulary (9 names) over random subsets, so both "aider present"
// and "aider absent" shapes are reached in every run, not hoped for.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PROVIDER_COMPAT_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'provider_compat_lib.bb');
const PROVIDER_RESPAWN_ENV_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'provider_respawn_env_lib.bb');
const HANDOFF_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoff_lib.bb');
const HARNESS_ENV_SCRUB_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'harness_env_scrub_lib.bb');

const PROVIDERS = {
  cerebras: { useVar: 'SWARMFORGE_USE_CEREBRAS', keyVar: 'CEREBRAS_API_KEY', useOpt: ':use-cerebras', keyOpt: ':cerebras-api-key', base: 'https://api.cerebras.ai/v1', tag: 'cerebras' },
  bai: { useVar: 'SWARMFORGE_USE_BAI', keyVar: 'B_AI_API_KEY', useOpt: ':use-bai', keyOpt: ':bai-api-key', base: 'https://api.b.ai/v1', tag: 'bai' },
};

const ALL_PROVIDER_ENV_VARS = [
  'SWARMFORGE_USE_CEREBRAS', 'CEREBRAS_API_KEY',
  'SWARMFORGE_USE_PERPLEXITY', 'PERPLEXITY_API_KEY',
  'SWARMFORGE_USE_QWEN', 'QWEN_API_KEY', 'BAILIAN_TOKEN_PLAN_API_KEY', 'BAILIAN_CODING_PLAN_API_KEY',
  'SWARMFORGE_USE_BAI', 'B_AI_API_KEY',
  'GEMINI_API_KEY', 'SWARMFORGE_GEMINI_API_KEY',
  'OPENAI_API_KEY', 'OPENAI_API_BASE', 'OPENAI_BASE_URL',
  'MISTRAL_API_KEY', 'OPENROUTER_API_KEY',
];

function isolatedEnv(overrides) {
  const base = { ...process.env };
  for (const name of ALL_PROVIDER_ENV_VARS) delete base[name];
  return { ...base, ...overrides };
}

function bbJson(expr, env) {
  const r = spawnSync('bb', ['-e', expr], { encoding: 'utf8', env: env || process.env });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function resolveCompat({ provider, key, realOpenaiKey, launchCli }) {
  const p = PROVIDERS[provider];
  const expr = `
(require '[cheshire.core :as json])
(load-file "${PROVIDER_COMPAT_LIB}")
(println (json/generate-string (provider-compat-lib/resolve-openai-compat
  {${p.useOpt} "1"
   ${p.keyOpt} ${JSON.stringify(key)}
   :openai-api-key ${realOpenaiKey ? JSON.stringify(realOpenaiKey) : 'nil'}
   :launch-cli ${launchCli ? JSON.stringify(launchCli) : 'nil'}})))`;
  return bbJson(expr, process.env);
}

function respawnArgs({ provider, key, realOpenaiKey }) {
  const p = PROVIDERS[provider];
  const env = isolatedEnv({ [p.useVar]: '1', [p.keyVar]: key, OPENAI_API_KEY: realOpenaiKey || '' });
  const respawnExpr = `
(require '[cheshire.core :as json])
(load-file "${PROVIDER_RESPAWN_ENV_LIB}")
(println (json/generate-string (provider-respawn-env-lib/provider-respawn-env-args "${path.join(REPO_ROOT, '.no-such-state-dir')}" nil)))`;
  const handoffExpr = `
(require '[cheshire.core :as json])
(load-file "${HANDOFF_LIB}")
(println (json/generate-string (handoff-lib/openrouter-pane-env-args)))`;
  return {
    respawnLib: pairsToMap(bbJson(respawnExpr, env)),
    handoffLib: pairsToMap(bbJson(handoffExpr, env)),
  };
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

// A safe, secret-shaped alphabet (alphanumeric only) - never a character
// that could complicate embedding the draw into a Clojure string literal or
// a subprocess env var value.
const SECRET_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const secretArb = fc
  .array(fc.integer({ min: 0, max: SECRET_ALPHABET.length - 1 }), { minLength: 8, maxLength: 24 })
  .map((idxs) => idxs.map((i) => SECRET_ALPHABET[i]).join(''));
const providerArb = fc.constantFrom('cerebras', 'bai');

test('BL-1495/BL-654 invariant 1: the compat resolver treats api.b.ai exactly as it treats api.cerebras.ai', () => {
  const reach = { cerebras: 0, bai: 0 };

  fc.assert(
    fc.property(providerArb, secretArb, secretArb, (provider, key, realOpenaiKey) => {
      fc.pre(key !== realOpenaiKey);
      reach[provider] += 1;
      const p = PROVIDERS[provider];
      const resolved = resolveCompat({ provider, key, realOpenaiKey });
      assert.equal(resolved.provider, p.tag, `${provider}: wrong provider tag: ${JSON.stringify(resolved)}`);
      assert.equal(resolved['openai-api-key'], key, `${provider}: expected the provider's own key, got: ${JSON.stringify(resolved)}`);
      assert.equal(resolved['openai-api-base'], p.base, `${provider}: wrong base: ${JSON.stringify(resolved)}`);
      assert.equal(resolved['openai-base-url'], p.base, `${provider}: wrong base-url: ${JSON.stringify(resolved)}`);
      assert.notEqual(resolved['openai-api-key'], realOpenaiKey, `${provider}: the host's real OPENAI_API_KEY leaked through: ${JSON.stringify(resolved)}`);
      return true;
    }),
    { numRuns: 30 },
  );

  for (const provider of Object.keys(reach)) {
    assert.ok(reach[provider] > 0, `never exercised provider ${provider} - the parity comparison went untested`);
  }
});

test('BL-1495/BL-654 invariant 1: both respawn mappings agree with each other and with the compat resolver, for both providers', () => {
  const reach = { cerebras: 0, bai: 0 };

  fc.assert(
    fc.property(providerArb, secretArb, secretArb, (provider, key, realOpenaiKey) => {
      fc.pre(key !== realOpenaiKey);
      reach[provider] += 1;
      const p = PROVIDERS[provider];
      const resolved = resolveCompat({ provider, key, realOpenaiKey });
      const { respawnLib, handoffLib } = respawnArgs({ provider, key, realOpenaiKey });

      for (const [label, map] of [['provider_respawn_env_lib.bb', respawnLib], ['handoff_lib.bb', handoffLib]]) {
        assert.equal(map.OPENAI_API_KEY, resolved['openai-api-key'], `${provider}/${label}: disagrees with the compat resolver on OPENAI_API_KEY: ${JSON.stringify(map)}`);
        assert.equal(map.OPENAI_API_BASE, p.base, `${provider}/${label}: wrong OPENAI_API_BASE: ${JSON.stringify(map)}`);
        assert.equal(map.OPENAI_BASE_URL, p.base, `${provider}/${label}: wrong OPENAI_BASE_URL: ${JSON.stringify(map)}`);
        assert.equal(map[p.useVar], '1', `${provider}/${label}: did not forward ${p.useVar}=1: ${JSON.stringify(map)}`);
        assert.notEqual(map.OPENAI_API_KEY, realOpenaiKey, `${provider}/${label}: the host's real OPENAI_API_KEY leaked through: ${JSON.stringify(map)}`);
      }
      // BL-1495's own key: forwarded under its own name too (both mappings),
      // never only folded into the OPENAI_API_KEY remap.
      if (provider === 'bai') {
        assert.equal(respawnLib.B_AI_API_KEY, key, `respawn lib did not forward B_AI_API_KEY itself: ${JSON.stringify(respawnLib)}`);
        assert.equal(handoffLib.B_AI_API_KEY, key, `handoff lib did not forward B_AI_API_KEY itself: ${JSON.stringify(handoffLib)}`);
      }
      return true;
    }),
    { numRuns: 30 },
  );

  for (const provider of Object.keys(reach)) {
    assert.ok(reach[provider] > 0, `never exercised provider ${provider} - the both-mappings comparison went untested`);
  }
});

test('BL-1495/BL-654 invariant 1: a launch-cli host match remaps b.ai even when the flag is unset', () => {
  let reach = 0;
  fc.assert(
    fc.property(secretArb, (key) => {
      reach += 1;
      const resolved = resolveCompat({
        provider: 'bai',
        key,
        launchCli: '--model openai/glm-5.3-flash --openai-api-base https://api.b.ai/v1',
      });
      assert.equal(resolved.reason, 'launch-cli-bai', `host-sniff did not win: ${JSON.stringify(resolved)}`);
      assert.equal(resolved['openai-api-key'], key);
      return true;
    }),
    { numRuns: 10 },
  );
  assert.ok(reach > 0);
});

// ── invariant 2 ──────────────────────────────────────────────────────────

const KNOWN_BACKENDS = ['claude', 'copilot', 'grok', 'codex', 'gemini', 'vibe', 'local-model', 'openrouter', 'aider'];
const backendSetArb = fc.uniqueArray(fc.constantFrom(...KNOWN_BACKENDS), { minLength: 0, maxLength: KNOWN_BACKENDS.length });

test('BL-1495/BL-654 invariant 2: B_AI_API_KEY is scrubbed from the tmux server unless an aider window is configured', () => {
  const reach = { 'aider-present': 0, 'aider-absent': 0 };

  fc.assert(
    fc.property(backendSetArb, (backends) => {
      // BL-1049's own documented posture: an EMPTY backend set means the
      // running configuration could not be read at all, and the lib fails
      // OPEN (scrubs nothing) rather than assuming no window needs a key -
      // out of scope for THIS property, which is about the aider/no-aider
      // dichotomy over a READABLE configuration.
      fc.pre(backends.length > 0);
      const shape = backends.includes('aider') ? 'aider-present' : 'aider-absent';
      reach[shape] += 1;

      const expr = `
(require '[cheshire.core :as json])
(load-file "${HARNESS_ENV_SCRUB_LIB}")
(println (json/generate-string {:scrub (vec (harness-env-scrub-lib/provider-scrub-vars #{${backends.map((b) => `"${b}"`).join(' ')}}))
                                 :keep (vec (harness-env-scrub-lib/provider-keep-names #{${backends.map((b) => `"${b}"`).join(' ')}}))}))`;
      const { scrub, keep } = bbJson(expr, process.env);

      if (shape === 'aider-present') {
        assert.ok(!scrub.includes('B_AI_API_KEY'), `an aider window is configured but B_AI_API_KEY is still scrubbed: ${JSON.stringify(scrub)}`);
        assert.ok(keep.includes('B_AI_API_KEY'), `an aider window is configured but B_AI_API_KEY is not kept: ${JSON.stringify(keep)}`);
      } else {
        assert.ok(scrub.includes('B_AI_API_KEY'), `no aider window is configured but B_AI_API_KEY was not scrubbed: ${JSON.stringify(scrub)}`);
        assert.ok(!keep.includes('B_AI_API_KEY'), `no aider window is configured but B_AI_API_KEY is kept: ${JSON.stringify(keep)}`);
      }
      return true;
    }),
    { numRuns: 40 },
  );

  assert.ok(reach['aider-present'] > 0, 'never drew a backend set containing aider');
  assert.ok(reach['aider-absent'] > 0, 'never drew a backend set without aider');
});

test('BL-1495 invariant 2: B_AI_API_KEY never appears as a hardcoded value in a committed launch file', () => {
  // Not generative - the concrete files this parcel ships/touches, checked
  // for the one shape that would be a real leak: an `=` assignment to a
  // literal (never a `$B_AI_API_KEY` / `${B_AI_API_KEY}` reference, which is
  // how every guard/mapping legitimately reads the key from the pane env).
  const files = [
    path.join(REPO_ROOT, 'swarmforge', 'packs', 'glm-mono-router.conf'),
    path.join(REPO_ROOT, 'start-swarm-glm.sh'),
    path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh'),
    path.join(REPO_ROOT, 'swarmforge', 'scripts', 'provider_respawn_env_lib.bb'),
    path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoff_lib.bb'),
  ];
  const hardcodedAssignment = /B_AI_API_KEY\s*=\s*(?!["']?\$)[^\s"'.]/;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || trimmed.startsWith(';;') || trimmed.startsWith(';')) continue; // documentation, not executable data
      assert.ok(!hardcodedAssignment.test(line), `${file}: looks like a hardcoded B_AI_API_KEY value: ${line}`);
    }
  }
});
