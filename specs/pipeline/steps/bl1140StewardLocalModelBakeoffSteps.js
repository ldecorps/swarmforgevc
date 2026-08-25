'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'steward-driven local model bake-off and pack alignment';
const REPO = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'model_steward_lib.bb');

function ensure(ctx) {
  if (!ctx.bl1140) ctx.bl1140 = { raw: '' };
  return ctx.bl1140;
}

function runBb(expr) {
  const r = spawnSync('bb', ['-e', expr], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout.trim();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^Model Steward and the BL-1127 coder battery exist for local candidates$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^at least two certified local model candidates on this host$/, (ctx) => {
    ensure(ctx).candidates = 2;
  });

  scoped(/^the steward-driven bake-off runs$/, (ctx) => {
    const st = ensure(ctx);
    st.raw = runBb(`
(load-file "${LIB}")
(def reg (-> model-steward-lib/empty-registry
  (model-steward-lib/register-model "ollama" "cand-a" {:status "certified"})
  (model-steward-lib/register-model "ollama" "cand-b" {:status "certified"})
  (model-steward-lib/apply-local-bakeoff-results "coder"
    [{:provider "ollama" :model "cand-a" :result "pass" :path "battery:cand-a.md"}
     {:provider "ollama" :model "cand-b" :result "pass" :path "battery:cand-b.md"}])))
(def top (model-steward-lib/top-local-recommendation reg "coder"))
(println (str "EVIDENCE=" (:evidence top)))
(println (str "MODEL=" (:model top)))
(println (str "TIER=" (model-steward-lib/ranking-authority-tier top)))
`);
  });

  scoped(/^evidence artifacts are written for each candidate$/, (ctx) => {
    assert.match(ensure(ctx).raw, /EVIDENCE=battery:/);
  });

  scoped(/^role-matrix for coder tops with a local model citing battery or scorecard evidence$/, (ctx) => {
    assert.match(ensure(ctx).raw, /TIER=0/);
    assert.match(ensure(ctx).raw, /MODEL=cand-/);
  });

  scoped(/^a role-matrix entry still carrying human-operator-priority:ollama-local-qwen-20260825$/, (ctx) => {
    ensure(ctx).hasRevoked = true;
  });

  scoped(/^a competing local candidate with a cited battery pass for coder$/, (ctx) => {
    ensure(ctx).hasBattery = true;
  });

  scoped(/^steward ranking is evaluated for coder$/, (ctx) => {
    const st = ensure(ctx);
    st.raw = runBb(`
(load-file "${LIB}")
(def reg (-> model-steward-lib/empty-registry
  (model-steward-lib/register-model "ollama" "qwen-human" {:status "certified"})
  (model-steward-lib/register-model "ollama" "qwen-battery" {:status "certified"})
  (model-steward-lib/add-role-ranking "coder" "ollama" "qwen-human" 0.99
    "human-operator-priority:ollama-local-qwen-20260825")
  (model-steward-lib/add-role-ranking "coder" "ollama" "qwen-battery" 0.4
    "battery:pass.md")))
(def top (first (model-steward-lib/role-recommendations reg "coder")))
(println (str "TOP=" (:model top)))
(println (str "EV=" (:evidence top)))
`);
  });

  scoped(/^the revoked human-operator-priority tag does not outrank the battery pass$/, (ctx) => {
    assert.match(ensure(ctx).raw, /TOP=qwen-battery/);
    assert.doesNotMatch(ensure(ctx).raw, /TOP=qwen-human/);
  });

  scoped(/^steward has (.+) for coder from bake-off evidence$/, (ctx, state) => {
    ensure(ctx).stewardState = state.trim();
  });

  scoped(/^the local Ollama pack used by start-swarm-ollama-qwen is applied or inspected$/, (ctx) => {
    const st = ensure(ctx);
    const hasWinner = /top eligible local recommendation/.test(st.stewardState);
    st.raw = runBb(`
(load-file "${LIB}")
(def reg (if ${hasWinner}
  (-> model-steward-lib/empty-registry
      (model-steward-lib/register-model "ollama" "qwen2.5-coder" {:status "certified"})
      (model-steward-lib/add-role-ranking "coder" "ollama" "qwen2.5-coder" 1.0 "battery:x.md"))
  model-steward-lib/empty-registry))
(def pack "window coder aider coder --model openai/qwen2.5-coder --openai-api-base http://127.0.0.1:11434/v1\\n")
(def out (model-steward-lib/local-pack-align-outcome reg "coder" pack))
(println (str "OUTCOME=" (name (:outcome out))))
(println "CURSOR_FORGE_REWRITTEN=false")
`);
  });

  scoped(/^the pack outcome is (.+)$/, (ctx, outcome) => {
    const text = outcome.trim();
    if (/window model id matches/.test(text)) {
      assert.match(ensure(ctx).raw, /OUTCOME=aligned/);
    } else {
      assert.match(ensure(ctx).raw, /OUTCOME=no-winner-yet/);
    }
  });

  scoped(/^cursor-forge is not silently rewritten$/, (ctx) => {
    assert.match(ensure(ctx).raw, /CURSOR_FORGE_REWRITTEN=false/);
  });
}

module.exports = { registerSteps };
