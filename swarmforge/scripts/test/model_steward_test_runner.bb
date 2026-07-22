#!/usr/bin/env bb
;; TDD runner for model_steward_lib.bb — BL-547 Slice 1. Pure assertions, no
;; tmux, no disk IO (model_steward_store.bb's fs adapter is covered by
;; test_model_steward_cli.sh instead). Model Steward owns the Model Registry,
;; Capability Registry, Role Recommendation Matrix, and Prompt Adapter
;; catalogue described in specs/features/BL-547-model-steward-infrastructure-agent.feature.
(ns model-steward-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "model_steward_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def empty-registry model-steward-lib/empty-registry)

;; ── model-registry-entry-01: every registered model has a lifecycle status ──
(doseq [[provider model status] [["anthropic" "claude-sonnet-5" "certified"]
                                  ["openai" "gpt-5.3-codex" "certified"]
                                  ["cerebras" "llama-3.3-70b" "candidate"]]]
  (let [reg (model-steward-lib/register-model empty-registry provider model
                                              {:status status :context_window 100000 :cost_class "medium"})
        entry (model-steward-lib/model-entry reg provider model)]
    (assert= (str "registered status for " provider "/" model) status (:status entry))
    (assert-true (str "metadata includes context window for " provider "/" model)
                 (some? (:context_window entry)))
    (assert-true (str "metadata includes cost class for " provider "/" model)
                 (some? (:cost_class entry)))))

(let [reg (model-steward-lib/register-model empty-registry "cerebras" "llama-3.3-70b" {})]
  (assert= "register-model defaults status to candidate when omitted"
           "candidate" (:status (model-steward-lib/model-entry reg "cerebras" "llama-3.3-70b"))))

;; ── capability-registry-dimensions-02: five benchmark dimensions present ────
(let [reg (model-steward-lib/set-capability-entry empty-registry "anthropic" "claude-sonnet-5"
                                                   {:coding_quality {:score 0.95}
                                                    :protocol_compliance {:score 0.98}
                                                    :tool_usage {:score 0.93}
                                                    :autonomy {:score 0.9}
                                                    :cost_latency {:score 0.7}})
      cap (model-steward-lib/capability-entry reg "anthropic" "claude-sonnet-5")]
  (doseq [dim [:coding_quality :protocol_compliance :tool_usage :autonomy :cost_latency]]
    (assert-true (str "capability entry includes " dim) (some? (get cap dim)))))

;; ── role-recommendation-matrix-03: top recommendation is certified, has evidence ─
(doseq [role ["architect" "coder" "cleaner" "QA" "hardender" "documenter" "specifier"]]
  (let [reg (-> empty-registry
                (model-steward-lib/register-model "anthropic" "claude-sonnet-5" {:status "certified" :context_window 200000 :cost_class "medium"})
                (model-steward-lib/register-model "cerebras" "llama-3.3-70b" {:status "candidate" :context_window 32000 :cost_class "low"})
                (model-steward-lib/add-role-ranking role "anthropic" "claude-sonnet-5" 0.95 "recruiter-scorecard:seed-01")
                (model-steward-lib/add-role-ranking role "cerebras" "llama-3.3-70b" 0.99 "recruiter-scorecard:seed-02"))
        ranked (model-steward-lib/role-recommendations reg role)]
    (assert-true (str "role matrix returns at least one entry for " role) (seq ranked))
    (assert= (str "top recommendation for " role " is the certified model despite lower raw score")
             "anthropic" (:provider (first ranked)))
    (assert-true (str "every ranked entry for " role " has an evidence pointer")
                 (every? #(some? (:evidence %)) ranked))
    (assert-true (str "role matrix excludes the uncertified candidate by default for " role)
                 (not-any? #(= "cerebras" (:provider %)) ranked))))

(let [reg (-> empty-registry
              (model-steward-lib/register-model "cerebras" "llama-3.3-70b" {:status "candidate" :context_window 32000 :cost_class "low"})
              (model-steward-lib/add-role-ranking "coder" "cerebras" "llama-3.3-70b" 0.5 "recruiter-scorecard:seed-03"))]
  (assert-true "role matrix can surface uncertified candidates when explicitly asked"
               (seq (model-steward-lib/role-recommendations reg "coder" {:include-uncertified? true}))))

;; ── prompt-adapter-catalogue-04: maps (provider, model) -> adapter id ───────
(let [reg (-> empty-registry
              (model-steward-lib/register-model "anthropic" "claude-sonnet-5" {:status "certified" :context_window 200000 :cost_class "medium"})
              (model-steward-lib/set-adapter-entry "anthropic" "claude-sonnet-5" {:adapter_id "generic" :production_default true})
              (model-steward-lib/register-model "cerebras" "llama-3.3-70b" {:status "candidate" :context_window 32000 :cost_class "low"})
              (model-steward-lib/set-adapter-entry "cerebras" "llama-3.3-70b" {:adapter_id "generic" :production_default false}))]
  (assert= "adapter catalogue returns the PromptEngine adapter id for a certified model"
           "generic" (:adapter_id (model-steward-lib/adapter-for reg "anthropic" "claude-sonnet-5")))
  (assert-true "a candidate model's adapter entry is not marked as a production default"
               (not (:production_default (model-steward-lib/adapter-for reg "cerebras" "llama-3.3-70b"))))
  (assert-true "production-adapter-for returns the adapter for a certified model"
               (some? (model-steward-lib/production-adapter-for reg "anthropic" "claude-sonnet-5")))
  (assert-true "production-adapter-for refuses an uncertified candidate model"
               (nil? (model-steward-lib/production-adapter-for reg "cerebras" "llama-3.3-70b"))))

(let [reg (-> empty-registry
              (model-steward-lib/register-model "anthropic" "claude-sonnet-5" {:status "certified" :context_window 200000 :cost_class "medium"})
              (model-steward-lib/set-adapter-entry "anthropic" "claude-sonnet-5" {:adapter_id "generic" :production_default false}))]
  (assert-true "production-adapter-for refuses a certified model whose adapter entry is not a production default"
               (nil? (model-steward-lib/production-adapter-for reg "anthropic" "claude-sonnet-5"))))

;; ── certification-gate-05: non-certified excluded from production unless override ─
(let [reg (model-steward-lib/register-model empty-registry "cerebras" "llama-3.3-70b" {:status "candidate" :context_window 32000 :cost_class "low"})]
  (assert-true "a candidate model is not assignment-eligible in production mode"
               (not (model-steward-lib/assignment-eligible? reg "cerebras" "llama-3.3-70b")))
  (assert-true "an explicit operator override permits an uncertified model"
               (model-steward-lib/assignment-eligible? reg "cerebras" "llama-3.3-70b" {:override-uncertified? true}))
  (assert-true "a certified model is always assignment-eligible"
               (model-steward-lib/assignment-eligible?
                (model-steward-lib/register-model empty-registry "anthropic" "claude-sonnet-5" {:status "certified" :context_window 200000 :cost_class "medium"})
                "anthropic" "claude-sonnet-5")))

;; ── certification-records-report-06: certifying records a report artifact path ──
(let [reg (model-steward-lib/register-model empty-registry "cerebras" "llama-3.3-70b" {:status "candidate" :context_window 32000 :cost_class "low"})
      certified (model-steward-lib/certify reg "cerebras" "llama-3.3-70b" "certification-reports/cerebras__llama-3.3-70b__seed.json")
      entry (model-steward-lib/model-entry certified "cerebras" "llama-3.3-70b")]
  (assert= "certify flips registry status to certified" "certified" (:status entry))
  (assert= "certify records the certification report artifact path"
           "certification-reports/cerebras__llama-3.3-70b__seed.json" (:certification_report_path entry)))

(let [report (model-steward-lib/build-certification-report "cerebras" "llama-3.3-70b" [] "2026-07-22T00:00:00Z")]
  (assert= "a Slice 1 manual certification report is marked certified" "certified" (:result report))
  (assert= "a certification report names its model" "llama-3.3-70b" (:model report))
  (assert= "a certification report names its provider" "cerebras" (:provider report)))

;; ── decertify-on-regression-07: regression drops status, records the reason ─
(let [reg (-> empty-registry
              (model-steward-lib/register-model "anthropic" "claude-sonnet-5" {:status "certified" :context_window 200000 :cost_class "medium"})
              (model-steward-lib/certify "anthropic" "claude-sonnet-5" "certification-reports/anthropic__claude-sonnet-5__prior.json"))
      decertified (model-steward-lib/decertify reg "anthropic" "claude-sonnet-5"
                                                "certification-reports/anthropic__claude-sonnet-5__regression.json"
                                                {:reason "coding_quality regressed below floor" :new-status "deprecated"})
      entry (model-steward-lib/model-entry decertified "anthropic" "claude-sonnet-5")]
  (assert= "decertify moves status to the given non-certified state" "deprecated" (:status entry))
  (assert= "decertify records the regression reason on the registry entry"
           "coding_quality regressed below floor" (:last_regression_reason entry))
  (assert= "decertify records the regression report artifact path on the registry entry"
           "certification-reports/anthropic__claude-sonnet-5__regression.json" (:certification_report_path entry)))

(assert-true "decertify rejects a new-status that is not candidate or deprecated"
             (try
               (model-steward-lib/decertify
                (model-steward-lib/register-model empty-registry "anthropic" "claude-sonnet-5" {:status "certified" :context_window 200000 :cost_class "medium"})
                "anthropic" "claude-sonnet-5" "certification-reports/anthropic__claude-sonnet-5__bad.json"
                {:reason "x" :new-status "certified"})
               false
               (catch Exception _ true)))

(let [report (model-steward-lib/build-regression-report
              "anthropic" "claude-sonnet-5"
              {:provider "anthropic" :model "claude-sonnet-5" :timestamp "2026-07-01T00:00:00Z" :result "certified"}
              "coding_quality regressed below floor" "2026-07-22T00:00:00Z")]
  (assert= "a regression report is marked regressed" "regressed" (:result report))
  (assert= "a regression report records the regression reason"
           "coding_quality regressed below floor" (:reason report))
  (assert-true "a regression report references the prior certification report"
               (some? (:prior_report report))))

;; A model certified only via the committed seed (never run through the
;; `certify` command) has no prior report at all — prior-report is nil.
;; build-regression-report must still record provider/model in that case,
;; not silently derive null/null identity from the absent prior report
;; (caught by end-to-end CLI smoke-testing, not by the unit tests above,
;; because every prior unit test supplied a non-nil prior-report).
(let [report (model-steward-lib/build-regression-report
              "anthropic" "claude-sonnet-5" nil
              "coding_quality regressed below floor" "2026-07-22T00:00:00Z")]
  (assert= "a regression report with no prior report still names its provider"
           "anthropic" (:provider report))
  (assert= "a regression report with no prior report still names its model"
           "claude-sonnet-5" (:model report))
  (assert-true "a regression report with no prior report has a nil prior_report, not a fabricated one"
               (nil? (:prior_report report))))

;; ── registry-summary: status command's data source ──────────────────────────
(let [reg (-> empty-registry
              (model-steward-lib/register-model "anthropic" "claude-sonnet-5" {:status "certified" :context_window 200000 :cost_class "medium"})
              (model-steward-lib/register-model "cerebras" "llama-3.3-70b" {:status "candidate" :context_window 32000 :cost_class "low"}))
      summary (model-steward-lib/registry-summary reg)]
  (assert= "registry-summary lists every registered model" 2 (count summary))
  (assert-true "registry-summary entries carry provider, model and status"
               (every? #(and (:provider %) (:model %) (:status %)) summary)))

;; ── seed transform: committed seed JSON becomes a registry ──────────────────
;; Composite "provider/model" keys arrive as plain strings, never keywords —
;; (keyword "anthropic/claude-sonnet-5") would silently split into a
;; namespaced keyword (namespace "anthropic", name "claude-sonnet-5"),
;; dropping the provider on any (name k) round-trip. model_steward_store.bb's
;; JSON key-fn is written to avoid ever producing that keyword.
(let [seed-data {:models [{:provider "anthropic" :model "claude-sonnet-5" :status "certified"
                            :context_window 200000 :cost_class "medium"}]
                  :capabilities {"anthropic/claude-sonnet-5" {:coding_quality {:score 0.9}}}
                  :role_matrix {:coder [{:provider "anthropic" :model "claude-sonnet-5" :score 0.9 :evidence "seed"}]}
                  :adapters {"anthropic/claude-sonnet-5" {:adapter_id "generic" :production_default true}}}
      reg (model-steward-lib/seed-data->registry seed-data)]
  (assert= "seed transform registers the seeded model" "certified"
           (:status (model-steward-lib/model-entry reg "anthropic" "claude-sonnet-5")))
  (assert-true "seed transform carries capability entries"
               (some? (model-steward-lib/capability-entry reg "anthropic" "claude-sonnet-5")))
  (assert-true "seed transform carries role matrix entries"
               (seq (model-steward-lib/role-recommendations reg "coder")))
  (assert= "seed transform carries adapter catalogue entries"
           "generic" (:adapter_id (model-steward-lib/adapter-for reg "anthropic" "claude-sonnet-5"))))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
