#!/usr/bin/env bb
;; TDD runner for model_factory_lib.bb — BL-525 Slice 1. Pure assertions, no
;; tmux, no disk IO (model_factory_store.bb's fs adapter + the launch seam
;; are covered by test_model_factory_cli.sh instead). ModelFactory resolves a
;; full-swarm role->{agent,provider,model} map under a cheap|quality steering
;; policy, grounded in Model Steward certification + role matrix, described
;; in specs/features/BL-525-model-factory-role-model-assignment.feature.
(ns model-factory-test-runner
  (:require [babashka.fs :as fs]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*)) ".."))
(load-file (str (fs/path scripts-dir "model_steward_lib.bb")))
(load-file (str (fs/path scripts-dir "model_factory_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def empty-registry model-steward-lib/empty-registry)

(defn reg-with-roles
  "A fixture registry: register every (provider, model, status, cost_class)
   in `models`, then rank each of them for every role in
   model-factory-lib/swarm-roles at the given score (so every scenario below
   can exercise assign-swarm across the full role set, not just \"coder\")."
  [models]
  (reduce
   (fn [reg [provider model status cost_class score]]
     (reduce (fn [reg role]
               (-> reg
                   (model-steward-lib/register-model provider model {:status status :cost_class cost_class})
                   (model-steward-lib/add-role-ranking role provider model score "fixture")))
             reg
             model-factory-lib/swarm-roles))
   empty-registry
   models))

;; ── assign-returns-role-map-01: one assignment per role, each fully named ───
(let [reg (reg-with-roles [["anthropic" "claude-sonnet-5" "certified" "medium" 0.9]])
      assignment (model-factory-lib/assign-swarm reg model-factory-lib/quality-mode)]
  (assert= "assign-swarm resolves every swarm role"
           (set model-factory-lib/swarm-roles) (set (keys assignment)))
  (assert-true "every assignment entry names an agent, provider, and model"
               (every? (fn [{:keys [agent provider model]}] (and agent provider model)) (vals assignment)))
  (assert-true "every assignment entry records its steering policy and a rationale"
               (every? (fn [{:keys [policy reason]}] (and (= model-factory-lib/quality-mode policy) (seq reason)))
                       (vals assignment))))

;; ── quality-mode-top-certified-02: top-ranked certified wins, cost ignored ──
(let [reg (reg-with-roles [["anthropic" "claude-sonnet-5" "certified" "high" 0.95]
                            ["openai" "gpt-5.3-codex" "certified" "low" 0.6]])
      entry (model-factory-lib/assign-role reg "coder" model-factory-lib/quality-mode)]
  (assert= "quality mode picks the top-ranked certified model even though a cheaper one is compliant"
           "anthropic" (:provider entry)))

;; ── cheap-mode-lowest-cost-eligible-03: lowest cost_class wins over score ───
(let [reg (reg-with-roles [["anthropic" "claude-sonnet-5" "certified" "medium" 0.95]
                            ["openai" "gpt-5.3-codex" "certified" "low" 0.6]])
      entry (model-factory-lib/assign-role reg "coder" model-factory-lib/cheap-mode)]
  (assert= "cheap mode picks the cost class \"low\" certified model over a higher-scored medium one"
           "openai" (:provider entry)))

;; ── certification-gate-holds-04: candidate never wins production without override ─
(let [reg (reg-with-roles [["cerebras" "llama-3.3-70b" "candidate" "low" 0.99]
                            ["openai" "gpt-5.3-codex" "certified" "medium" 0.6]])
      entry (model-factory-lib/assign-role reg "coder" model-factory-lib/cheap-mode)]
  (assert-true "the lowest-cost candidate model is not assigned without an override"
               (not= "cerebras" (:provider entry)))
  (assert= "a certified model is assigned instead of the uncertified candidate"
           "openai" (:provider entry)))

;; ── uncertified-override-05: explicit override permits the candidate ───────
(let [reg (reg-with-roles [["cerebras" "llama-3.3-70b" "candidate" "low" 0.99]
                            ["openai" "gpt-5.3-codex" "certified" "medium" 0.6]])
      entry (model-factory-lib/assign-role reg "coder" model-factory-lib/cheap-mode {:override-uncertified? true})]
  (assert= "an explicit override permits the uncertified candidate to be assigned"
           "cerebras" (:provider entry))
  (assert-true "the rationale records that an uncertified override was used"
               (clojure.string/includes? (:reason entry) "uncertified override")))

;; ── daily-cap-failover-06: exhausted-today provider excluded in cheap mode ──
(let [reg (reg-with-roles [["cerebras" "llama-3.3-70b" "certified" "low" 0.99]
                            ["openai" "gpt-5.3-codex" "certified" "medium" 0.6]])
      quota-state {:cerebras {:exhausted_date "2026-07-22"}}
      entry (model-factory-lib/assign-role reg "coder" model-factory-lib/cheap-mode
                                            {:quota-state quota-state :today "2026-07-22"})]
  (assert-true "a provider exhausted for today is not assigned in cheap mode"
               (not= "cerebras" (:provider entry)))
  (assert= "openai is assigned as the eligible certified fallback"
           "openai" (:provider entry)))

;; ── daily-cap-resets-next-day-07: a stale exhausted_date no longer excludes ──
(let [reg (reg-with-roles [["cerebras" "llama-3.3-70b" "certified" "low" 0.99]
                            ["openai" "gpt-5.3-codex" "certified" "medium" 0.6]])
      quota-state {:cerebras {:exhausted_date "2026-07-21"}}
      entry (model-factory-lib/assign-role reg "coder" model-factory-lib/cheap-mode
                                            {:quota-state quota-state :today "2026-07-22"})]
  (assert= "cerebras is preferred again once its exhausted_date is not today"
           "cerebras" (:provider entry)))

;; quality mode never excludes on quota — it is a cheap-mode-only input.
(let [reg (reg-with-roles [["cerebras" "llama-3.3-70b" "certified" "low" 0.99]
                            ["openai" "gpt-5.3-codex" "certified" "medium" 0.6]])
      quota-state {:cerebras {:exhausted_date "2026-07-22"}}
      entry (model-factory-lib/assign-role reg "coder" model-factory-lib/quality-mode
                                            {:quota-state quota-state :today "2026-07-22"})]
  (assert= "quality mode ignores quota exhaustion and still picks the top-ranked certified model"
           "cerebras" (:provider entry)))

;; no eligible candidate survives -> nil, not an exception
(assert-true "assign-role returns nil when no eligible candidate survives"
             (nil? (model-factory-lib/assign-role empty-registry "coder" model-factory-lib/quality-mode)))

;; assign-swarm omits a role with no eligible candidate rather than erroring,
;; while every other role in the map is still resolved (documented in
;; assign-swarm's docstring: "a role with no eligible candidate is simply
;; absent from the map").
(let [reg (as-> empty-registry $
            (model-steward-lib/register-model $ "anthropic" "claude-sonnet-5" {:status "certified" :cost_class "medium"})
            (model-steward-lib/add-role-ranking $ "coder" "anthropic" "claude-sonnet-5" 0.9 "fixture"))
      assignment (model-factory-lib/assign-swarm reg model-factory-lib/quality-mode)]
  (assert= "assign-swarm resolves only the roles with an eligible candidate"
           #{"coder"} (set (keys assignment)))
  (assert-true "assign-swarm never includes a role with no eligible candidate"
               (not (contains? assignment "architect"))))

;; ── cost-class-rank: a missing cost_class must sort LAST in cheap mode, not
;; be treated as equal-or-better than a known cost class (cost-class-rank's
;; documented default of unknown-cost-rank=3, higher than "high"=2) ─────────
(let [reg (reg-with-roles [["anthropic" "claude-sonnet-5" "certified" nil 0.99]
                            ["openai" "gpt-5.3-codex" "certified" "high" 0.1]])
      entry (model-factory-lib/assign-role reg "coder" model-factory-lib/cheap-mode)]
  (assert= "cheap mode prefers a known cost_class (even \"high\") over a missing cost_class, regardless of score"
           "openai" (:provider entry)))

;; ── pick-cheap: within the same cost_class, the tie is broken by score
;; descending (cost dominates; score is only a tiebreaker per pick-cheap's
;; docstring) — assert the HIGHER-scored same-cost-class candidate wins.
(let [reg (reg-with-roles [["anthropic" "claude-sonnet-5" "certified" "low" 0.4]
                            ["openai" "gpt-5.3-codex" "certified" "low" 0.9]])
      entry (model-factory-lib/assign-role reg "coder" model-factory-lib/cheap-mode)]
  (assert= "cheap mode breaks a cost_class tie by preferring the higher score"
           "openai" (:provider entry)))

;; ── cold-apply-plan-08: pure plan shape (overlay write + seam invocation are store's job) ─
(let [plan (model-factory-lib/cold-apply-plan "codex-mono-router" "/tmp/whatever/assignment.json")]
  (assert= "cold-apply-plan names the overlay path it will relaunch against"
           "/tmp/whatever/assignment.json" (:overlay_path plan))
  (assert= "cold-apply-plan names the target pack" "codex-mono-router" (:pack plan))
  (assert= "cold-apply-plan's stop step runs kill_all_swarm.sh"
           "kill_all_swarm.sh" (get-in plan [:stop :script]))
  (assert= "cold-apply-plan's relaunch step runs swarm against the resolved pack"
           ["--pack" "codex-mono-router"] (get-in plan [:relaunch :args])))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
