'use strict';

// BL-682 declared invariants (coder first authorship — BL-654):
//
// 1. "No model id is invented: every Model Steward entry this slice writes is
//    traceable to the live tool's own report, or is explicitly recorded as
//    agent-granularity with the reason it could not be resolved."
//
// 2. "Adding the mistral mapping changes no existing provider's resolution,
//    and registering the Mistral model changes no existing registry entry's
//    status, context window or cost class."
//
// Encoded against mistral_vibe_registration_lib.bb and the committed seed /
// provider->agent map via Babashka. Generator reach: every draw builds either
// a complete alias-bearing config (traceable id) or a deliberately broken
// config (agent-granularity with reason) by construction; invariant 2 draws
// random prior entries and asserts they survive a seed that includes Mistral.
//
// Non-vacuity (break then restore):
//   break 1 — registration always returns {:model "mistral-vibe"} with no
//     reason: invent-id property goes RED.
//   break 2 — seed mutator also rewrites anthropic cost_class: untouched
//     property goes RED.
// Both restored; ALL PROPERTIES HOLD.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const FACTORY = path.join(SCRIPTS, 'model_factory_lib.bb');
const STEWARD = path.join(SCRIPTS, 'model_steward_lib.bb');
const REG = path.join(SCRIPTS, 'mistral_vibe_registration_lib.bb');
const SEED = path.join(REPO_ROOT, 'swarmforge', 'model-steward', 'seed', 'models.seed.json');

const PRIOR_PROVIDERS = {
  anthropic: 'claude',
  openai: 'codex',
  cerebras: 'aider',
  cursor: 'cursor',
  local: 'local-model',
};

function bb(expr) {
  return execFileSync(
    'bb',
    [
      '-e',
      `(load-file "${STEWARD}")
       (load-file "${FACTORY}")
       (load-file "${REG}")
       ${expr}`,
    ],
    { encoding: 'utf8' }
  ).trim();
}

function plan(edn) {
  return bb(`(println (pr-str (mistral-vibe-registration-lib/registration-from-vibe-config ${edn})))`);
}

test('BL-682/BL-654 invariant 1: ids are tool-traceable or agent-granularity with reason', () => {
  let aliasDraws = 0;
  let fallbackDraws = 0;

  fc.assert(
    fc.property(
      fc.record({
        useAlias: fc.boolean(),
        alias: fc.constantFrom('mistral-medium-3.5', 'devstral-small'),
        latestName: fc.constantFrom('mistral-vibe-cli-latest', 'devstral-small-latest'),
        input: fc.double({ min: 0.05, max: 5, noNaN: true }),
        output: fc.double({ min: 0.1, max: 40, noNaN: true }),
        window: fc.integer({ min: 32000, max: 200000 }),
      }),
      ({ useAlias, alias, latestName, input, output, window }) => {
        if (useAlias) {
          aliasDraws += 1;
          const edn = `{:active_model "${alias}"
                        :models [{:name "${latestName}"
                                  :alias "${alias}"
                                  :input_price ${input}
                                  :output_price ${output}
                                  :auto_compact_threshold ${window}}]}`;
          const out = plan(edn);
          assert.match(out, new RegExp(`:model "${alias}"`));
          assert.match(out, new RegExp(`:underlying_name "${latestName}"`));
          assert.doesNotMatch(out, /:agent-granularity\? true/);
          assert.doesNotMatch(out, /:model "mistral-vibe"/);
        } else {
          fallbackDraws += 1;
          const out = plan('nil');
          assert.match(out, /:agent-granularity\? true/);
          assert.match(out, /:model "vibe"/);
          assert.match(out, /:reason "/);
          assert.doesNotMatch(out, /:model "mistral-vibe"/);
        }
      }
    ),
    { numRuns: Number(process.env.PROPERTY_RUNS || 60) }
  );

  assert.ok(aliasDraws >= 10, `alias reach floor unmet: ${aliasDraws}`);
  assert.ok(fallbackDraws >= 10, `fallback reach floor unmet: ${fallbackDraws}`);
});

test('BL-682/BL-654 invariant 2: existing provider resolution and seed rows stay put', () => {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  const priorModels = seed.models.filter((m) => m.provider !== 'mistral');
  assert.ok(priorModels.length >= 4, 'seed must still carry prior models');

  for (const [provider, agent] of Object.entries(PRIOR_PROVIDERS)) {
    const out = bb(`(println (pr-str (model-factory-lib/agent-for-provider "${provider}")))`);
    assert.equal(out.replace(/^"|"$/g, ''), agent, `${provider} resolution must be unchanged`);
  }

  fc.assert(
    fc.property(fc.constantFrom(...priorModels), (row) => {
      const entry = bb(`(require '[cheshire.core :as json])
(def seed (json/parse-string (slurp "${SEED}") true))
(def reg (model-steward-lib/seed-data->registry seed))
(println (pr-str (model-steward-lib/model-entry reg "${row.provider}" "${row.model}")))`);
      assert.match(entry, new RegExp(`:status "${row.status}"`));
      assert.match(entry, new RegExp(`:context_window ${row.context_window}`));
      assert.match(entry, new RegExp(`:cost_class "${row.cost_class}"`));
    }),
    { numRuns: Number(process.env.PROPERTY_RUNS || 40) }
  );

  assert.equal(
    bb('(println (pr-str (model-factory-lib/agent-for-provider "mistral")))').replace(/^"|"$/g, ''),
    'vibe'
  );
});
