#!/usr/bin/env bb
;; BL-1053 TDD runner: the intelligence layer can route work to a Qwen seat.
;;
;; ModelFactory resolves a model's launch CLI through provider->agent. That
;; map knew three providers and none of them was qwen, so once BL-1052 made a
;; qwen-code seat launchable the layer still could not select it - and the
;; plausible shortcut made it worse: qwen-code authenticates with
;; --auth-type openai because the wire protocol is OpenAI-compatible, so
;; registering qwen models under provider "openai" looks right and resolves
;; to "codex", launching them through the Codex CLI.
;;
;; Pure assertions over the real libraries. Kept in its own runner rather
;; than appended to model_factory_test_runner.bb because the sharpest check
;; here reaches ACROSS a boundary that runner deliberately does not cross -
;; every agent named in provider->agent must be an agent swarmforge.sh can
;; actually launch, which only prompt_engine_lib.bb knows.

(ns bl1053-qwen-provider-routing-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*)) ".."))
(def repo-root (fs/parent (fs/parent (fs/canonicalize scripts-dir))))
(load-file (str (fs/path scripts-dir "model_steward_lib.bb")))
(load-file (str (fs/path scripts-dir "model_factory_lib.bb")))
(load-file (str (fs/path scripts-dir "prompt_engine_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg expr] (when-not expr (swap! failures conj (str "FAIL: " msg))))

;; ── 01: the qwen provider resolves to the qwen-code launch agent ─────────
(assert= "provider 'qwen' resolves to the qwen-code launch agent"
         "qwen-code" (model-factory-lib/agent-for-provider "qwen"))

;; And the agent it names is one swarmforge.sh can actually launch. A typo
;; here ("qwen_code", "qwencode") would satisfy every same-file assertion and
;; still fail at launch with "Unsupported agent" - the map's value is only
;; meaningful against the launcher's own allow-list.
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

;; The whole trap, stated directly: qwen must not be reachable THROUGH openai.
(assert-true "provider 'openai' must not resolve to the qwen-code agent - that is the shortcut this ticket exists to close"
             (not= "qwen-code" (model-factory-lib/agent-for-provider "openai")))

;; ── 03: an unknown provider fails loudly rather than falling through ─────
(assert= "an unknown provider names no launch agent"
         nil (model-factory-lib/agent-for-provider "not-a-provider"))

(let [res (model-factory-lib/resolve-launch-agent "not-a-provider")]
  (assert-true "resolving an unknown provider reports it as unknown"
               (false? (:known? res)))
  (assert= "an unknown provider's resolution names no launch agent"
           nil (:agent res))
  (assert-true "the unknown-provider report names the provider it could not resolve"
               (clojure.string/includes? (str (:reason res)) "not-a-provider"))
  (assert-true "the unknown-provider report names the keys it does know, so the fix is obvious from the message"
               (clojure.string/includes? (str (:reason res)) "qwen")))

(let [res (model-factory-lib/resolve-launch-agent "qwen")]
  (assert-true "resolving a registered provider reports it as known" (true? (:known? res)))
  (assert= "a registered provider's resolution names its launch agent"
           "qwen-code" (:agent res)))

;; An assignment must never be handed downstream naming no agent: a
;; descriptor with :agent nil reads as an ordinary entry to every consumer.
(let [reg (-> model-steward-lib/empty-registry
              (model-steward-lib/register-model "not-a-provider" "m1"
                                                {:status "certified" :cost_class "low"})
              (model-steward-lib/add-role-ranking "coder" "not-a-provider" "m1" 0.9 "fixture"))
      thrown (try (model-factory-lib/assign-role reg "coder" model-factory-lib/quality-mode)
                  nil
                  (catch Exception e (.getMessage e)))]
  (assert-true "assigning a role from a provider with no launch agent must throw, not emit a descriptor naming no agent"
               (some? thrown))
  (assert-true (str "the throw must name the offending provider; got: " (pr-str thrown))
               (and thrown (clojure.string/includes? thrown "not-a-provider"))))

;; A registered provider still assigns normally - the guard above must not
;; have turned every assignment into a throw.
(let [reg (-> model-steward-lib/empty-registry
              (model-steward-lib/register-model "qwen" "qwen3.7-plus"
                                                {:status "certified" :cost_class "low"})
              (model-steward-lib/add-role-ranking "coder" "qwen" "qwen3.7-plus" 0.9 "fixture"))
      entry (model-factory-lib/assign-role reg "coder" model-factory-lib/quality-mode)]
  (assert= "a qwen assignment names the qwen-code agent" "qwen-code" (:agent entry))
  (assert= "a qwen assignment keeps its own provider key" "qwen" (:provider entry)))

;; ── 04: a Token Plan model registers under the qwen provider ─────────────
(let [reg (model-steward-lib/register-model model-steward-lib/empty-registry
                                            "qwen" "qwen3.7-plus"
                                            {:status "candidate" :cost_class "low"})
      entry (model-steward-lib/model-entry reg "qwen" "qwen3.7-plus")]
  (assert= "the registry holds the model under provider 'qwen'" "qwen" (:provider entry))
  (assert= "the registry keeps the model's declared cost class" "low" (:cost_class entry))
  (assert= "a newly registered model is a candidate, never certified by default"
           "candidate" (:status entry))
  (assert-true "registering under 'qwen' must not also create an 'openai' entry"
               (nil? (model-steward-lib/model-entry reg "openai" "qwen3.7-plus"))))

;; The SHIPPED seed carries the Token Plan models, so a fresh state directory
;; already knows them - a CLI registration writes only to gitignored runtime
;; state and would be lost the next time the registry was seeded.
(let [seed (json/parse-string (slurp (str (fs/path repo-root "swarmforge" "model-steward"
                                                   "seed" "models.seed.json")))
                              true)
      qwen-rows (filter #(= "qwen" (:provider %)) (:models seed))]
  (assert-true "the shipped seed registers no Token Plan model under provider 'qwen'"
               (seq qwen-rows))
  (assert-true "every seeded Token Plan model must be a candidate - seeding one as certified would assert a certification run that never happened"
               (every? #(= "candidate" (:status %)) qwen-rows))
  (assert-true "every seeded Token Plan model must declare a cost class - cheap-mode ranks an unknown cost class LAST, so an omitted one silently forfeits the cost reduction this whole intake exists to buy"
               (every? #(contains? #{"low" "medium" "high"} (:cost_class %)) qwen-rows))
  (assert-true "no Token Plan model may be seeded under provider 'openai' - that is the shortcut that resolves to codex"
               (not-any? #(and (= "openai" (:provider %))
                               (clojure.string/starts-with? (:model %) "qwen"))
                         (:models seed))))

;; ── 05: registration alone changes no running seat ───────────────────────
;; A seat runs on the model its launch resolved; the overlay is the only
;; thing that can change one, and registering a model writes no overlay.
(let [seat-overlay nil
      before (model-factory-lib/resolve-role-model seat-overlay "coder" "claude-sonnet-5")
      _ (model-steward-lib/register-model model-steward-lib/empty-registry
                                          "qwen" "qwen3.7-plus"
                                          {:status "candidate" :cost_class "low"})
      after (model-factory-lib/resolve-role-model seat-overlay "coder" "claude-sonnet-5")]
  (assert= "the seat was running on its launched model before registration"
           "claude-sonnet-5" before)
  (assert= "the seat is still running on its launched model after registration"
           "claude-sonnet-5" after))

(if (empty? @failures)
  (println "bl1053 qwen provider routing: ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
