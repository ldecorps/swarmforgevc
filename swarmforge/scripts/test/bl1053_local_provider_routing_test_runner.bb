#!/usr/bin/env bb
;; BL-1053 TDD runner: the intelligence layer can route work to a local-model seat.
;;
;; ModelFactory resolves a model's launch CLI through provider->agent. That
;; map knew cloud providers only, so once BL-1052 made a local-model seat
;; launchable the layer still could not select it - and the plausible
;; shortcut made it worse: a local endpoint speaks the OpenAI-compatible
;; protocol, so registering an on-host model under provider "openai" looks
;; right and resolves to "codex", launching it through a cloud CLI.
;;
;; Pure assertions over the real libraries. Kept in its own runner rather
;; than appended to model_factory_test_runner.bb because the sharpest check
;; here reaches ACROSS a boundary that runner deliberately does not cross -
;; every agent named in provider->agent must be an agent swarmforge.sh can
;; actually launch, which only prompt_engine_lib.bb knows.

(ns bl1053-local-provider-routing-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*)) ".."))
(load-file (str (fs/path scripts-dir "model_steward_lib.bb")))
(load-file (str (fs/path scripts-dir "model_factory_lib.bb")))
(load-file (str (fs/path scripts-dir "prompt_engine_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg expr] (when-not expr (swap! failures conj (str "FAIL: " msg))))

(defn certified-provider-registry
  "Minimal steward registry: one certified model under `provider`, ranked for `role`."
  [provider model role score]
  (-> model-steward-lib/empty-registry
      (model-steward-lib/register-model provider model
                                        {:status "certified" :cost_class "low"})
      (model-steward-lib/add-role-ranking role provider model score "fixture")))

;; ── 01: the local provider resolves to the local-model seat agent ────────
(assert= "provider 'local' resolves to the local-model seat agent"
         "local-model" (model-factory-lib/agent-for-provider "local"))

;; And the agent it names is one swarmforge.sh can actually launch. A typo
;; here ("local_model", "localmodel") would satisfy every same-file assertion
;; and still fail at launch with "Unsupported agent".
(doseq [[provider agent] (sort model-factory-lib/provider->agent)]
  (assert-true (str "provider '" provider "' names agent '" agent
                    "', which is not an agent the launcher supports")
               (contains? prompt-engine-lib/supported-agents agent))
  (assert-true (str "agent '" agent "' (provider '" provider
                    "') has no provider-capabilities entry of its own")
               (contains? prompt-engine-lib/provider-capabilities agent)))

;; ── 02: the existing provider keys are unchanged ─────────────────────────
(assert= "provider 'anthropic' still resolves to claude"
         "claude" (model-factory-lib/agent-for-provider "anthropic"))
(assert= "provider 'openai' still resolves to codex"
         "codex" (model-factory-lib/agent-for-provider "openai"))
(assert= "provider 'cerebras' still resolves to aider"
         "aider" (model-factory-lib/agent-for-provider "cerebras"))

;; The whole trap, stated directly: local must not be reachable THROUGH openai.
(assert-true "provider 'openai' must not resolve to the local-model agent - that is the shortcut this ticket exists to close"
             (not= "local-model" (model-factory-lib/agent-for-provider "openai")))

;; ── 03: an unknown provider fails loudly rather than falling through ─────
(assert= "an unknown provider names no launch agent"
         nil (model-factory-lib/agent-for-provider "not-a-provider"))

(let [res (model-factory-lib/resolve-launch-agent "not-a-provider")]
  (assert-true "resolving an unknown provider reports it as unknown"
               (false? (:known? res)))
  (assert= "an unknown provider's resolution names no launch agent"
           nil (:agent res))
  (assert-true "the unknown-provider report names the provider it could not resolve"
               (str/includes? (str (:reason res)) "not-a-provider"))
  (assert-true "the unknown-provider report names the keys it does know, so the fix is obvious from the message"
               (str/includes? (str (:reason res)) "local")))

(let [res (model-factory-lib/resolve-launch-agent "local")]
  (assert-true "resolving a registered provider reports it as known" (true? (:known? res)))
  (assert= "a registered provider's resolution names its launch agent"
           "local-model" (:agent res)))

;; An assignment must never be handed downstream naming no agent.
(let [reg (certified-provider-registry "not-a-provider" "m1" "coder" 0.9)
      thrown (try (model-factory-lib/assign-role reg "coder" model-factory-lib/quality-mode)
                  nil
                  (catch Exception e (.getMessage e)))]
  (assert-true "assigning a role from a provider with no launch agent must throw, not emit a descriptor naming no agent"
               (some? thrown))
  (assert-true (str "the throw must name the offending provider; got: " (pr-str thrown))
               (and thrown (str/includes? thrown "not-a-provider"))))

;; A registered provider still assigns normally.
(let [reg (certified-provider-registry "local" "qwen2.5-coder:7b-instruct" "coder" 0.9)
      entry (model-factory-lib/assign-role reg "coder" model-factory-lib/quality-mode)]
  (assert= "a local assignment names the local-model agent" "local-model" (:agent entry))
  (assert= "a local assignment keeps its own provider key" "local" (:provider entry)))

;; ── 04: a downloaded model registers under the local provider ────────────
(let [reg (model-steward-lib/register-model model-steward-lib/empty-registry
                                            "local" "qwen2.5-coder:7b-instruct"
                                            {:status "candidate" :cost_class "low"})
      entry (model-steward-lib/model-entry reg "local" "qwen2.5-coder:7b-instruct")]
  (assert= "the registry holds the model under provider 'local'" "local" (:provider entry))
  (assert= "the registry keeps the model's declared cost class" "low" (:cost_class entry))
  (assert= "a newly registered model is a candidate, never certified by default"
           "candidate" (:status entry))
  (assert-true "registering under 'local' must not also create an 'openai' entry"
               (nil? (model-steward-lib/model-entry reg "openai" "qwen2.5-coder:7b-instruct"))))

;; ── 05: a second downloaded model needs no new provider entry ────────────
(let [map-before model-factory-lib/provider->agent
      reg (-> model-steward-lib/empty-registry
              (model-steward-lib/register-model "local" "qwen2.5-coder:7b-instruct"
                                                {:status "candidate" :cost_class "low"})
              (model-steward-lib/register-model "local" "llama3.1:8b"
                                                {:status "candidate" :cost_class "low"}))
      second (model-steward-lib/model-entry reg "local" "llama3.1:8b")]
  (assert= "the second model is held under provider 'local'" "local" (:provider second))
  (assert= "registering a second local model leaves provider->agent unchanged"
           map-before model-factory-lib/provider->agent)
  (assert= "the local key still resolves to local-model after a second registration"
           "local-model" (model-factory-lib/agent-for-provider "local")))

;; ── 06: registration alone changes no running seat ───────────────────────
(let [seat-overlay nil
      before (model-factory-lib/resolve-role-model seat-overlay "coder" "claude-sonnet-5")
      _ (model-steward-lib/register-model model-steward-lib/empty-registry
                                          "local" "qwen2.5-coder:7b-instruct"
                                          {:status "candidate" :cost_class "low"})
      after (model-factory-lib/resolve-role-model seat-overlay "coder" "claude-sonnet-5")]
  (assert= "the seat was running on its launched model before registration"
           "claude-sonnet-5" before)
  (assert= "the seat is still running on its launched model after registration"
           "claude-sonnet-5" after))

(if (empty? @failures)
  (println "bl1053 local provider routing: ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
