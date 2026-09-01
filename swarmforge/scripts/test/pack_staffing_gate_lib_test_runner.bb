#!/usr/bin/env bb
;; TDD runner for pack_staffing_gate_lib.bb (BL-1318) — pure assertions
;; only: fixture registry maps and scorecard maps built in-memory, no fs,
;; no timers. The lib under test is PURE; evidence IO belongs to
;; pack_staffing_gate_cli.bb and is exercised by test_pack_staffing_gate.sh.
;;
;; Every fixture seat is pinned through a shape the resolution table covers
;; (the live packs' own shapes) — the table is seeded from live packs by
;; design and never grows a fixture-only entry.
(ns pack-staffing-gate-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(let [here (fs/parent (fs/canonicalize *file*))]
  (load-file (str (fs/path here ".." "model_steward_lib.bb")))
  (load-file (str (fs/path here ".." "pack_staffing_gate_lib.bb"))))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-truthy [msg actual]
  (when-not actual
    (swap! failures conj (str "FAIL: " msg "\n  expected truthy, actual: " (pr-str actual)))))

;; ── fixture builders ─────────────────────────────────────────────────────
;; Resolvable identities the fixtures seat:
;;   claude --model qwen3.8-max                        -> qwen/qwen3.8-max
;;   aider --model openai/deepseek-v4-flash + deepseek -> deepseek/deepseek-v4-flash
;;   aider --model openai/qwen3.7-plus + aliyuncs      -> qwen/qwen3.7-plus
;;   claude --model claude-sonnet-5                    -> anthropic/claude-sonnet-5
;;   cursor --model auto                               -> cursor/auto

(defn fixture-registry
  "qwen/qwen3.8-max fully cleared for QA; deepseek/deepseek-v4-flash
   certified and ranked for coder ONLY (the nemotron shape); the rest
   registered but not cleared for QA."
  []
  (-> model-steward-lib/empty-registry
      (model-steward-lib/register-model "qwen" "qwen3.8-max" {:status "certified"})
      (model-steward-lib/register-model "qwen" "qwen3.7-plus" {:status "certified"})
      (model-steward-lib/register-model "deepseek" "deepseek-v4-flash" {:status "certified"})
      (model-steward-lib/register-model "anthropic" "claude-sonnet-5" {:status "certified"})
      (model-steward-lib/register-model "cursor" "auto" {:status "certified"})
      (model-steward-lib/add-role-ranking "QA" "qwen" "qwen3.8-max" 0.8
                                          "compliance-battery:fixture-20260901:qwen3.8-max")
      (model-steward-lib/add-role-ranking "QA" "qwen" "qwen3.7-plus" 0.72
                                          "operator-onboard:fixture-20260901")
      (model-steward-lib/add-role-ranking "coder" "deepseek" "deepseek-v4-flash" 0.72
                                          "compliance-battery:fixture-20260901:deepseek-v4-flash")))

(defn fixture-scorecards
  "Scorecard map keyed by provider/model. The per-role gate statuses are
   the knobs each scenario turns."
  []
  {"qwen/qwen3.8-max"
   {:model "qwen3.8-max"
    :entries [{:competency "QA-gate" :status "pass" :reason "fixture"}]}
   "qwen/qwen3.7-plus"
   {:model "qwen3.7-plus"
    :entries [{:competency "QA-gate" :status "pass" :reason "fixture"}]}
   "deepseek/deepseek-v4-flash"
   {:model "deepseek-v4-flash"
    :entries [{:competency "coder-gate" :status "pass" :reason "fixture"}
              {:competency "QA-gate" :status "human-verdict-pending" :reason "fixture"}]}
   "anthropic/claude-sonnet-5"
   {:model "claude-sonnet-5"
    :entries [{:competency "QA-gate" :status "pass" :reason "fixture"}]}})

(def evidence {:registry (fixture-registry) :scorecards (fixture-scorecards)})

(defn decide
  ([role agent extra-cli] (decide role agent extra-cli {}))
  ([role agent extra-cli opts]
   (pack-staffing-gate-lib/seat-staffing-decision evidence role agent extra-cli opts)))

;; ── resolve-seat — table-driven steward identity ─────────────────────────

(assert= "cursor --model auto resolves to cursor/auto"
         {:status :resolved :provider "cursor" :model "auto"}
         (pack-staffing-gate-lib/resolve-seat "cursor" "--model auto"))

(assert= "claude --model claude-sonnet-5 resolves to anthropic/claude-sonnet-5"
         {:status :resolved :provider "anthropic" :model "claude-sonnet-5"}
         (pack-staffing-gate-lib/resolve-seat "claude" "--model claude-sonnet-5 --dangerously-skip-permissions"))

(assert= "claude --model qwen3.8-max resolves to qwen/qwen3.8-max (gateway seat)"
         {:status :resolved :provider "qwen" :model "qwen3.8-max"}
         (pack-staffing-gate-lib/resolve-seat "claude" "--model qwen3.8-max --effort high"))

(assert= "aider openai/qwen3.7-plus on the aliyuncs base resolves to qwen/qwen3.7-plus"
         {:status :resolved :provider "qwen" :model "qwen3.7-plus"}
         (pack-staffing-gate-lib/resolve-seat
          "aider" "--model openai/qwen3.7-plus --openai-api-base https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1 --no-gitignore"))

(assert= "aider openai/deepseek-v4-flash on the deepseek base resolves to deepseek/deepseek-v4-flash"
         {:status :resolved :provider "deepseek" :model "deepseek-v4-flash"}
         (pack-staffing-gate-lib/resolve-seat
          "aider" "--model openai/deepseek-v4-flash --openai-api-base https://api.deepseek.com"))

(assert= "an api-base host the table does not cover is unresolved, not guessed"
         :unresolved
         (:status (pack-staffing-gate-lib/resolve-seat
                   "aider" "--model openai/mystery-1 --openai-api-base https://api.example.com/v1")))

(assert= "a claude model the table does not cover is unresolved, not guessed"
         :unresolved
         (:status (pack-staffing-gate-lib/resolve-seat "claude" "--model mystery-2")))

(assert= "aider naming openai/<model> with no api-base is unresolved, not guessed"
         :unresolved
         (:status (pack-staffing-gate-lib/resolve-seat "aider" "--model openai/mystery-3")))

(assert= "a window line pinning no model is a no-pin seat (resolver has nothing to resolve)"
         :no-pin
         (:status (pack-staffing-gate-lib/resolve-seat "vibe" "--max-price 2.00")))

(assert= "an agent-none window line is a no-pin seat"
         :no-pin
         (:status (pack-staffing-gate-lib/resolve-seat "none" "")))

;; ── seat-staffing-decision — the three checks, fail closed ───────────────

(let [d (decide "QA" "cursor" "--model auto")]
  (assert= "a seat absent from the role matrix refuses" "refuse" (:decision d))
  (assert= "an absent seat names the not-on-role-matrix check"
           "not-on-role-matrix" (:failing-check d))
  (assert= "an absent seat refusal names the role and resolved identity"
           ["QA" "cursor" "auto"] [(:role d) (:provider d) (:model d)])
  (assert-truthy "an absent seat refusal carries a runnable steward command"
                 (str/includes? (str (:steward-command d)) "model_steward_cli.bb role-matrix QA")))

(let [d (decide "QA" "aider" "--model openai/deepseek-v4-flash --openai-api-base https://api.deepseek.com")]
  ;; certified and globally registered, ranked for coder, absent from the QA
  ;; matrix — the live nemotron shape that motivated this ticket.
  (assert= "a globally-certified model absent from this role's matrix refuses (nemotron shape)"
           "refuse" (:decision d))
  (assert= "the nemotron shape names not-on-role-matrix before any other check"
           "not-on-role-matrix" (:failing-check d)))

(let [d (decide "coder" "aider" "--model openai/deepseek-v4-flash --openai-api-base https://api.deepseek.com")]
  ;; ranked for coder with a passing coder-gate and certification: clears.
  (assert= "a seat ranked with a passing role gate and certification passes"
           "pass" (:decision d))
  (assert= "a passing seat names no failing check" nil (:failing-check d)))

(let [pending-evidence (assoc-in evidence [:scorecards "deepseek/deepseek-v4-flash" :entries]
                                 [{:competency "coder-gate" :status "human-verdict-pending"}])
      d (pack-staffing-gate-lib/seat-staffing-decision
         pending-evidence "coder" "aider"
         "--model openai/deepseek-v4-flash --openai-api-base https://api.deepseek.com" {})]
  (assert= "a ranked seat whose role gate is human-verdict-pending refuses"
           "refuse" (:decision d))
  (assert= "a pending role gate names role-gate-not-pass" "role-gate-not-pass" (:failing-check d))
  (assert-truthy "a pending role gate refusal carries a runnable battery command"
                 (str/includes? (str (:steward-command d)) "compliance_battery.bb gate coder")))

(let [no-scorecard (assoc evidence :scorecards {})
      d (pack-staffing-gate-lib/seat-staffing-decision
         no-scorecard "QA" "claude" "--model qwen3.8-max" {})]
  (assert= "a ranked, certified seat with no scorecard fails closed" "refuse" (:decision d))
  (assert= "a missing scorecard names role-gate-not-pass" "role-gate-not-pass" (:failing-check d)))

(let [decertified (assoc evidence :registry
                         (model-steward-lib/decertify (fixture-registry) "qwen" "qwen3.8-max"
                                                      "certification-reports/regressed.json"
                                                      {:reason "fixture regression" :new-status "candidate"}))
      d (pack-staffing-gate-lib/seat-staffing-decision
         decertified "QA" "claude" "--model qwen3.8-max" {})]
  (assert= "a ranked seat with a passing gate that lost assignment-eligibility refuses"
           "refuse" (:decision d))
  (assert= "a decertified seat names not-assignment-eligible"
           "not-assignment-eligible" (:failing-check d))
  (assert-truthy "a decertified seat refusal carries a runnable steward command"
                 (str/includes? (str (:steward-command d)) "model_steward_cli.bb")))

(let [d (decide "QA" "aider" "--model openai/qwen3.7-plus --openai-api-base https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1")]
  (assert= "a fully cleared seat passes" "pass" (:decision d))
  (assert= "a fully cleared seat names its resolved identity"
           ["qwen" "qwen3.7-plus"] [(:provider d) (:model d)]))

;; check ordering: matrix membership before role gate before eligibility
(let [bare (-> model-steward-lib/empty-registry
               (model-steward-lib/register-model "qwen" "qwen3.8-max" {:status "candidate"}))
      d (pack-staffing-gate-lib/seat-staffing-decision
         {:registry bare :scorecards {}} "QA" "claude" "--model qwen3.8-max" {})]
  (assert= "a seat failing every check reports not-on-role-matrix first"
           "not-on-role-matrix" (:failing-check d)))

(let [reg (-> model-steward-lib/empty-registry
              (model-steward-lib/register-model "qwen" "qwen3.8-max" {:status "candidate"})
              (model-steward-lib/add-role-ranking "QA" "qwen" "qwen3.8-max" 0.5
                                                  "operator-onboard:fixture"))
      d (pack-staffing-gate-lib/seat-staffing-decision
         {:registry reg :scorecards {}} "QA" "claude" "--model qwen3.8-max" {})]
  (assert= "a ranked seat without any scorecard reports role-gate-not-pass before eligibility"
           "role-gate-not-pass" (:failing-check d)))

;; BL-1140: a revoked human-operator-priority ranking entry never counts
(let [reg (-> model-steward-lib/empty-registry
              (model-steward-lib/register-model "anthropic" "claude-sonnet-5" {:status "certified"})
              (model-steward-lib/add-role-ranking "QA" "anthropic" "claude-sonnet-5" 0.99
                                                  model-steward-lib/revoked-human-priority-tag))
      d (pack-staffing-gate-lib/seat-staffing-decision
         {:registry reg :scorecards {"anthropic/claude-sonnet-5"
                                      {:model "claude-sonnet-5"
                                       :entries [{:competency "QA-gate" :status "pass"}]}}}
         "QA" "claude" "--model claude-sonnet-5" {})]
  (assert= "a revoked human-operator-priority ranking never satisfies the matrix check"
           "not-on-role-matrix" (:failing-check d)))

;; hardender seats consult the hardener-gate competency (scorecard spelling)
(let [ev {:registry (-> model-steward-lib/empty-registry
                        (model-steward-lib/register-model "cursor" "auto" {:status "certified"})
                        (model-steward-lib/add-role-ranking "hardender" "cursor" "auto" 0.86
                                                            "compliance-battery:fixture"))
          :scorecards {"cursor/auto"
                       {:model "auto"
                        :entries [{:competency "hardener-gate" :status "pass"}]}}}]
  (assert= "hardender seats consult the hardener-gate scorecard competency"
           "pass" (:decision (pack-staffing-gate-lib/seat-staffing-decision
                              ev "hardender" "cursor" "--model auto" {}))))

;; ── unresolvable seats refuse (invariant 1) ─────────────────────────────

(let [d (decide "QA" "claude" "--model mystery-9")]
  (assert= "an unresolvable seat refuses rather than staffing" "refuse" (:decision d))
  (assert= "an unresolvable seat names seat-model-unresolved"
           "seat-model-unresolved" (:failing-check d)))

;; ── no-pin seats staff unchanged (pack pins nothing for the steward) ─────

(let [d (decide "cleaner" "vibe" "--max-price 2.00")]
  (assert= "a no-pin seat staffs with a pass decision" "pass" (:decision d))
  (assert= "a no-pin seat resolves no provider" nil (:provider d))
  (assert= "a no-pin seat resolves no model" nil (:model d))
  (assert-truthy "a no-pin seat is marked as such" (:no-pin? d)))

;; ── override: loud, recorded, never a pass (invariant 3) ────────────────

(let [d (decide "QA" "cursor" "--model auto" {:override? true})]
  (assert= "an override turns a refusal into a staffed override decision"
           "override" (:decision d))
  (assert= "an override keeps the failing check it overrides"
           "not-on-role-matrix" (:failing-check d))
  (assert= "an override decision is never the string pass"
           false (= "pass" (:decision d))))

(let [d (decide "QA" "claude" "--model mystery-9" {:override? true})]
  (assert= "an override also staffs an unresolvable seat" "override" (:decision d))
  (assert= "an overridden unresolvable seat keeps its check"
           "seat-model-unresolved" (:failing-check d)))

(let [d (decide "QA" "aider" "--model openai/qwen3.7-plus --openai-api-base https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
                {:override? true})]
  (assert= "an override on an already-cleared seat stays a plain pass"
           "pass" (:decision d))
  (assert= "an override on a cleared seat names no failing check" nil (:failing-check d)))

(let [d (decide "cleaner" "vibe" "--max-price 2.00" {:override? true})]
  (assert= "an override on a no-pin seat stays a plain pass" "pass" (:decision d)))

;; ── decisions always carry the three-value vocabulary (invariant 1) ──────

(doseq [[role agent extra] [["QA" "cursor" "--model auto"]
                            ["QA" "aider" "--model openai/qwen3.7-plus --openai-api-base https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"]
                            ["QA" "claude" "--model mystery-9"]
                            ["cleaner" "vibe" "--max-price 2.00"]]
        opts [{} {:override? true}]]
  (let [d (pack-staffing-gate-lib/seat-staffing-decision evidence role agent extra opts)]
    (assert-truthy (str "every decision lands in the pass/refuse/override vocabulary: " role " " extra " " opts)
                   (contains? #{"pass" "refuse" "override"} (:decision d)))))

;; ── report ───────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (run! println @failures)
    (println (str "pack_staffing_gate_lib_test_runner: " (count @failures) " FAILURE(S)"))
    (System/exit 1))
  (println "pack_staffing_gate_lib_test_runner: all assertions passed"))
