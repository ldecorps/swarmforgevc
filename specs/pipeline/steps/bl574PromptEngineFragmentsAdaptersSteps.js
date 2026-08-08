'use strict';

// BL-574: step handlers for "PromptEngine composes from named fragments
// with per-model adapters" (BL-546 Slice 2). Drives the REAL
// prompt_engine_lib.bb via `bb -e` subprocess calls - the established
// pattern for Babashka-backed Gherkin steps in this repo (see
// backlogDepthCapOverrideSteps.js's execFileSync('bb', ['-e', ...])).
// Babashka process state (the adapter registry atom, an in-memory fragment
// cache) does not persist across process boundaries, so every scenario
// that needs two related actions in the SAME cache/registry (already
// composed + recompose; register + select) runs both inside ONE bb
// subprocess triggered from its When step - Given steps only accumulate
// plain JS-side context, never execute bb themselves.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PROMPT_ENGINE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'prompt_engine_lib.bb');

function runBb(clojureSource) {
  return execFileSync('bb', ['-e', clojureSource], { encoding: 'utf8', cwd: REPO_ROOT });
}

const LOAD_LIB = `(load-file "${PROMPT_ENGINE_LIB}")`;

const FRAGMENT_MARKERS = {
  constitution: '# SwarmForge Constitution',
  pipeline: '# Parcel Flow',
  role: 'You are the coder.',
  'pack-overlay': 'The following swarm-profile overlay applies to your role.',
};

function registerSteps(registry) {
  // ── Background: a PromptEngine compose request for role "coder" ─────────
  registry.define(/^a PromptEngine compose request for role "([^"]+)"$/, (ctx, role) => {
    ctx.bl574Role = role;
    ctx.bl574TwoPack = false;
    ctx.bl574OverlayPrompt = '';
  });

  // ── Scenario 01: a named fragment contributes its content ───────────────
  registry.define(/^the compose request includes fragment "([^"]+)"$/, (ctx, fragment) => {
    ctx.bl574Fragment = fragment;
    if (fragment === 'pack-overlay') {
      // Real, existing overlay prompt file - fragment-source-path resolves
      // "pack-overlay" straight through to this repo-relative path.
      ctx.bl574OverlayPrompt = 'swarmforge/packs/mono-router.prompt';
    }
  });

  registry.define(/^PromptEngine composes the system prompt$/, (ctx) => {
    const clj = `${LOAD_LIB}
(print (:system-prompt (prompt-engine-lib/compose "${ctx.bl574Role}" {:agent "claude" :two-pack? ${ctx.bl574TwoPack} :overlay-prompt "${ctx.bl574OverlayPrompt}"})))`;
    ctx.bl574ComposedText = runBb(clj);
  });

  registry.define(/^the composed prompt includes content from fragment "([^"]+)"$/, (ctx, fragment) => {
    const marker = FRAGMENT_MARKERS[fragment];
    if (!marker) {
      throw new Error(`unknown fragment "${fragment}" - no expected marker registered`);
    }
    if (!ctx.bl574ComposedText.includes(marker)) {
      throw new Error(`expected the composed prompt to include content from fragment "${fragment}" (marker: "${marker}")`);
    }
  });

  // ── Scenario 02: the adapter is chosen from the model and provider ──────
  registry.define(/^the compose request targets model "([^"]+)" on provider "([^"]+)"$/, (ctx, model, provider) => {
    ctx.bl574Model = model;
    ctx.bl574Provider = provider;
  });

  registry.define(/^PromptEngine applies the model adapter$/, (ctx) => {
    // Prints two lines: the selected adapter id, then whether this
    // provider's stable prefix (constitution+pipeline, verbatim) equals a
    // plain-claude baseline compose's stable prefix in the SAME process.
    const clj = `${LOAD_LIB}
(let [target (prompt-engine-lib/compose "${ctx.bl574Role}" {:agent "${ctx.bl574Provider}" :model "${ctx.bl574Model}"})
      baseline (prompt-engine-lib/compose "${ctx.bl574Role}" {:agent "claude"})]
  (println (:adapter-id (:metadata target)))
  (println (= (:stable-prefix target) (:stable-prefix baseline))))`;
    const lines = runBb(clj).trim().split('\n');
    ctx.bl574SelectedAdapter = lines[0];
    ctx.bl574ConstitutionUnchanged = lines[1] === 'true';
  });

  registry.define(/^the selected adapter id is "([^"]+)"$/, (ctx, adapter) => {
    if (ctx.bl574SelectedAdapter !== adapter) {
      throw new Error(`expected selected adapter id "${adapter}", got "${ctx.bl574SelectedAdapter}"`);
    }
  });

  registry.define(/^the constitution fragment content is unchanged$/, (ctx) => {
    if (ctx.bl574ConstitutionUnchanged !== true) {
      throw new Error('expected this provider\'s composed stable prefix (constitution+pipeline) to equal the baseline claude compose\'s stable prefix');
    }
  });

  // ── Scenario 03: an adapter registered after startup is selected ────────
  registry.define(/^an adapter is registered for provider "([^"]+)"$/, (ctx, provider) => {
    ctx.bl574NewAdapterProvider = provider;
  });

  registry.define(/^the compose request targets provider "([^"]+)"$/, (ctx, provider) => {
    // register-adapter! and select-adapter must run in the SAME bb process
    // for the registration to be visible to the lookup (Given/When are
    // separate JS calls but must not be separate bb subprocesses here).
    const clj = `${LOAD_LIB}
(prompt-engine-lib/register-adapter! "${ctx.bl574NewAdapterProvider}" "${ctx.bl574NewAdapterProvider}")
(println (prompt-engine-lib/select-adapter "${provider}"))`;
    ctx.bl574SelectedAdapter = runBb(clj).trim();
  });

  // ── Scenario 04: an unchanged fragment is not re-read ────────────────────
  registry.define(/^PromptEngine has already composed the system prompt once$/, (ctx) => {
    ctx.bl574AlreadyComposed = true;
  });

  registry.define(/^no fragment file has changed since that compose$/, (ctx) => {
    ctx.bl574ChangedFragment = null;
  });

  registry.define(/^fragment "([^"]+)" has changed on disk since that compose$/, (ctx, fragment) => {
    ctx.bl574ChangedFragment = fragment;
  });

  registry.define(/^PromptEngine recomposes the system prompt$/, (ctx) => {
    // One bb subprocess performs BOTH "already composed once" and
    // "recomposes" against the SAME fragment-cache atom, with a
    // call-counting content-fn standing in for the real disk read (this
    // project's "decision logic pure and unit-testable with no
    // filesystem" rule - no real file is touched or mutated by this test).
    // When a fragment "has changed", the content-fn returns a new,
    // version-tagged value on its NEXT read and the cache entry for that
    // fragment is explicitly invalidated first - invalidation is this
    // cache's only signal that a fragment changed (mtime is unusable per
    // BL-373; see invalidate-fragment's docstring in prompt_engine_lib.bb).
    const changedFragment = ctx.bl574ChangedFragment;
    const invalidateForm = changedFragment
      ? `(swap! cache prompt-engine-lib/invalidate-fragment "${changedFragment}")`
      : '';
    const clj = `${LOAD_LIB}
(def read-count (atom 0))
(def role-version (atom 0))
(defn spy-content-fn [name req]
  (swap! read-count inc)
  (if (= name "${changedFragment || ''}")
    (do (swap! role-version inc) (str "ROLE_CONTENT_V" @role-version))
    (prompt-engine-lib/fragment-content-uncached name req)))
(def cache (atom (prompt-engine-lib/empty-fragment-cache)))
(prompt-engine-lib/compose "${ctx.bl574Role}" {:agent "claude" :fragment-cache cache :fragment-content-fn spy-content-fn})
(def after-first @read-count)
${invalidateForm}
(def second-compose (prompt-engine-lib/compose "${ctx.bl574Role}" {:agent "claude" :fragment-cache cache :fragment-content-fn spy-content-fn}))
(def after-second @read-count)
(println after-first)
(println after-second)
(println (clojure.string/includes? (:system-prompt second-compose) "ROLE_CONTENT_V2"))`;
    const lines = runBb(clj).trim().split('\n');
    ctx.bl574ReadCountAfterFirst = parseInt(lines[0], 10);
    ctx.bl574ReadCountAfterSecond = parseInt(lines[1], 10);
    ctx.bl574CarriesChangedContent = lines[2] === 'true';
  });

  registry.define(/^no fragment file is re-read$/, (ctx) => {
    if (ctx.bl574ReadCountAfterSecond !== ctx.bl574ReadCountAfterFirst) {
      throw new Error(
        `expected no additional fragment reads on recompose, but read count went from ${ctx.bl574ReadCountAfterFirst} to ${ctx.bl574ReadCountAfterSecond}`
      );
    }
  });

  registry.define(/^fragment "([^"]+)" is re-read$/, (ctx, fragment) => {
    if (!(ctx.bl574ReadCountAfterSecond > ctx.bl574ReadCountAfterFirst)) {
      throw new Error(
        `expected fragment "${fragment}" to be re-read on recompose (read count should increase), stayed at ${ctx.bl574ReadCountAfterFirst}`
      );
    }
  });

  registry.define(/^the composed prompt carries the changed content$/, (ctx) => {
    if (!ctx.bl574CarriesChangedContent) {
      throw new Error('expected the recomposed system prompt to carry the changed fragment content');
    }
  });
}

module.exports = { registerSteps };
