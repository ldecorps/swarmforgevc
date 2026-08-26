#!/usr/bin/env bb
;; BL-682 unit checks for mistral_vibe_registration_lib.bb and the
;; provider->agent / seed wiring that makes Mistral reachable.
(require '[babashka.fs :as fs]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def scripts-dir (fs/parent script-dir))
(load-file (str (fs/path scripts-dir "model_steward_lib.bb")))
(load-file (str (fs/path scripts-dir "model_factory_lib.bb")))
(load-file (str (fs/path scripts-dir "mistral_vibe_registration_lib.bb")))

(def failures (atom []))
(defn assert= [label expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL " label ": expected " (pr-str expected) " got " (pr-str actual)))))
(defn assert-true [label actual]
  (when-not actual
    (swap! failures conj (str "FAIL " label ": expected truthy"))))

;; ── provider->agent ──────────────────────────────────────────────────────
(assert= "mistral routes to vibe"
         "vibe" (model-factory-lib/agent-for-provider "mistral"))
(assert= "anthropic unchanged" "claude" (model-factory-lib/agent-for-provider "anthropic"))
(assert= "openai unchanged" "codex" (model-factory-lib/agent-for-provider "openai"))
(assert= "cerebras unchanged" "aider" (model-factory-lib/agent-for-provider "cerebras"))
(assert= "cursor unchanged" "cursor" (model-factory-lib/agent-for-provider "cursor"))
(assert= "local unchanged" "local-model" (model-factory-lib/agent-for-provider "local"))
(assert-true "unknown provider still has no agent (BL-1053)"
             (nil? (model-factory-lib/agent-for-provider "no-such-provider")))

;; ── cost class from rates (not session cap) ──────────────────────────────
(assert= "live mistral-medium rates classify medium"
         "medium"
         (mistral-vibe-registration-lib/cost-class-from-token-prices 1.5 7.5))
(assert= "cheap rates classify low"
         "low"
         (mistral-vibe-registration-lib/cost-class-from-token-prices 0.1 0.3))
(assert= "expensive rates classify high"
         "high"
         (mistral-vibe-registration-lib/cost-class-from-token-prices 10.0 30.0))

;; ── registration from vibe config ────────────────────────────────────────
(def live-shaped
  {:active_model "mistral-medium-3.5"
   :models [{:name "mistral-vibe-cli-latest"
             :provider "mistral"
             :alias "mistral-medium-3.5"
             :input_price 1.5
             :output_price 7.5
             :auto_compact_threshold 200000}]})

(let [plan (mistral-vibe-registration-lib/registration-from-vibe-config live-shaped)]
  (assert= "registers the alias, not the latest pointer"
           "mistral-medium-3.5" (:model plan))
  (assert= "provider mistral" "mistral" (:provider plan))
  (assert= "context window from compaction threshold" 200000 (:context_window plan))
  (assert= "cost class from token prices" "medium" (:cost_class plan))
  (assert= "underlying name recorded" "mistral-vibe-cli-latest" (:underlying_name plan))
  (assert-true "not agent-granularity when alias exists" (not (:agent-granularity? plan))))

(let [plan (mistral-vibe-registration-lib/registration-from-vibe-config nil)]
  (assert-true "absent config uses agent granularity" (:agent-granularity? plan))
  (assert= "agent-granularity model is vibe" "vibe" (:model plan))
  (assert-true "reason recorded" (string? (:reason plan))))

;; Never invent a plausible id when only a latest name exists without alias.
(let [plan (mistral-vibe-registration-lib/registration-from-vibe-config
            {:active_model "mistral-vibe-cli-latest"
             :models [{:name "mistral-vibe-cli-latest"
                       :provider "mistral"
                       :input_price 1.5
                       :output_price 7.5
                       :auto_compact_threshold 200000}]})]
  (assert-true "latest-without-alias falls back to agent granularity"
               (:agent-granularity? plan))
  (assert= "fallback model is vibe, never a fabricated id" "vibe" (:model plan)))

;; ── seed carries Mistral; other entries untouched ────────────────────────
(def seed-path (fs/path (fs/parent scripts-dir) "model-steward" "seed" "models.seed.json"))
(def seed (json/parse-string (slurp (str seed-path)) true))
(def before-snapshot
  {"anthropic/claude-sonnet-5" {:status "certified" :context_window 200000 :cost_class "medium"}
   "openai/gpt-5.3-codex" {:status "certified" :context_window 128000 :cost_class "medium"}
   "cerebras/llama-3.3-70b" {:status "candidate" :context_window 32000 :cost_class "low"}
   "cursor/auto" {:status "candidate" :context_window 200000 :cost_class "medium"}})

(let [reg (model-steward-lib/seed-data->registry seed)
      mistral (model-steward-lib/model-entry reg "mistral" "mistral-medium-3.5")]
  (assert-true "seed lists mistral model" (some? mistral))
  (assert= "seed cost class medium" "medium" (:cost_class mistral))
  (assert= "seed context window" 200000 (:context_window mistral))
  (assert= "seed underlying name" "mistral-vibe-cli-latest" (:underlying_name mistral))
  (doseq [[k expected] before-snapshot]
    (let [[provider model] (str/split k #"/" 2)
          entry (model-steward-lib/model-entry reg provider model)]
      (assert= (str k " status untouched") (:status expected) (:status entry))
      (assert= (str k " context_window untouched") (:context_window expected) (:context_window entry))
      (assert= (str k " cost_class untouched") (:cost_class expected) (:cost_class entry)))))

(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
