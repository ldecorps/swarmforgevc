#!/usr/bin/env bb
;; BL-1182: TDD runner for model_steward_trial_lib.bb — the day-long BoB trial
;; lifecycle. Pure assertions only; the CLI's disk and seat effects are covered
;; by test_model_steward_trial_cli.sh, and the acceptance drives the whole
;; nominate -> assess -> promote/revert chain end to end.
(ns model-steward-trial-lib-test-runner
  (:require [babashka.fs :as fs]))

(def scripts-dir (str (fs/path (fs/parent (fs/canonicalize *file*)) "..")))
(load-file (str (fs/path scripts-dir "model_steward_trial_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))


(defn registry-with
  "A registry carrying two models for `role` with the given scores and cost
   classes - the smallest shape assess reads."
  [role {:keys [perm-score perm-cost trial-score trial-cost trial-status]}]
  (-> model-steward-lib/empty-registry
      (model-steward-lib/register-model "anthropic" "perm-model"
                                        {:status "certified" :cost_class perm-cost})
      (model-steward-lib/register-model "cerebras" "trial-model"
                                        {:status (or trial-status "certified") :cost_class trial-cost})
      (model-steward-lib/add-role-ranking role "anthropic" "perm-model" perm-score "scorecard: perm")
      (cond-> trial-score
        (model-steward-lib/add-role-ranking role "cerebras" "trial-model" trial-score "scorecard: trial"))))

(def permanent {:provider "anthropic" :model "perm-model" :cost_class "medium"})
(def candidate {:provider "cerebras" :model "trial-model"})
(def t0 "2026-08-30T09:00:00Z")

;; ── nominate ──────────────────────────────────────────────────────────────

(let [reg (registry-with "coder" {:perm-score 7 :perm-cost "medium" :trial-score 8 :trial-cost "low"})
      {:keys [trials trial error]} (model-steward-trial-lib/nominate
                                    model-steward-trial-lib/empty-trials reg "coder" candidate permanent t0)]
  (assert= "nominate does not refuse a certified candidate" nil error)
  (assert= "nominate arms the trial" "armed" (:status trial))
  (assert= "nominate records the role's permanent model" permanent (:permanent trial))
  (assert= "nominate records the candidate's cost class" "low" (:cost_class trial))
  (assert= "the trial window is one operating day"
           "2026-08-31T09:00:00Z" (:ends_at trial))
  (assert= "the armed trial is readable by role" trial (model-steward-trial-lib/armed-for-role trials "coder")))

(let [reg (registry-with "coder" {:perm-score 7 :perm-cost "medium" :trial-score 8 :trial-cost "low"})
      once (:trials (model-steward-trial-lib/nominate
                     model-steward-trial-lib/empty-trials reg "coder" candidate permanent t0))
      twice (model-steward-trial-lib/nominate once reg "coder" candidate permanent t0)]
  (assert-true "a second nomination for the same role is refused" (some? (:error twice)))
  (assert-true "the refusal names the armed trial"
               (clojure.string/includes? (:error twice) "trial-model")))

(let [reg (registry-with "coder" {:perm-score 7 :perm-cost "medium" :trial-score 8 :trial-cost "low"
                                  :trial-status "candidate"})
      out (model-steward-trial-lib/nominate model-steward-trial-lib/empty-trials reg "coder" candidate permanent t0)]
  (assert-true "an uncertified candidate is refused" (some? (:error out)))
  (assert-true "the refusal says why" (clojure.string/includes? (:error out) "not certified")))

(let [reg (registry-with "coder" {:perm-score 7 :perm-cost "medium" :trial-score 8 :trial-cost "low"})
      out (model-steward-trial-lib/nominate model-steward-trial-lib/empty-trials reg "coder"
                                            {:provider "anthropic" :model "perm-model"} permanent t0)]
  (assert-true "trialling the permanent model is refused" (some? (:error out)))
  (assert-true "the refusal says it is already permanent"
               (clojure.string/includes? (:error out) "already permanent")))

;; ── decide: outrank, tie->cheap, lose ─────────────────────────────────────

(assert= "an outranking trial is promoted" :promote
         (:decision (model-steward-trial-lib/decide
                     {:trial-score 9 :permanent-score 7 :trial-cost "high" :permanent-cost "low"})))

(assert= "an outranked trial reverts" :revert
         (:decision (model-steward-trial-lib/decide
                     {:trial-score 5 :permanent-score 7 :trial-cost "low" :permanent-cost "high"})))

(assert= "a tie goes to the cheaper trial" :promote
         (:decision (model-steward-trial-lib/decide
                     {:trial-score 7 :permanent-score 7 :trial-cost "low" :permanent-cost "high"})))

(assert= "a tie goes to the cheaper permanent" :revert
         (:decision (model-steward-trial-lib/decide
                     {:trial-score 7 :permanent-score 7 :trial-cost "high" :permanent-cost "low"})))

(assert= "a tie on score AND cost keeps the incumbent" :revert
         (:decision (model-steward-trial-lib/decide
                     {:trial-score 7 :permanent-score 7 :trial-cost "medium" :permanent-cost "medium"})))

(assert= "an unscored trial reverts rather than promoting on absent evidence" :revert
         (:decision (model-steward-trial-lib/decide
                     {:trial-score nil :permanent-score 7 :trial-cost "low" :permanent-cost "high"})))

(assert= "a scored trial beats an unscored permanent" :promote
         (:decision (model-steward-trial-lib/decide
                     {:trial-score 3 :permanent-score nil :trial-cost "high" :permanent-cost "low"})))

;; ── assess: seat, history, loser evidence ─────────────────────────────────

(let [reg (registry-with "coder" {:perm-score 7 :perm-cost "medium" :trial-score 9 :trial-cost "high"})
      armed (:trials (model-steward-trial-lib/nominate
                      model-steward-trial-lib/empty-trials reg "coder" candidate permanent t0))
      {:keys [trials outcome]} (model-steward-trial-lib/assess armed reg "coder" "2026-08-31T09:00:00Z")]
  (assert= "an outranking trial promotes" :promote (:decision outcome))
  (assert= "the seat becomes the trialled model" "cerebras/trial-model"
           (model-steward-trial-lib/seat-id (:seat outcome)))
  (assert= "the armed trial is cleared" nil (model-steward-trial-lib/armed-for-role trials "coder"))
  (assert= "the closed trial is recorded" "promoted" (:status (last (:history trials))))
  (assert= "a promotion records no loser" [] (model-steward-trial-lib/losers-for-role trials "coder")))

(let [reg (registry-with "coder" {:perm-score 9 :perm-cost "medium" :trial-score 4 :trial-cost "low"})
      armed (:trials (model-steward-trial-lib/nominate
                      model-steward-trial-lib/empty-trials reg "coder"
                      (assoc candidate :evidence "scorecards/first.json") permanent t0))
      {:keys [trials outcome]} (model-steward-trial-lib/assess armed reg "coder" "2026-08-31T09:00:00Z")]
  (assert= "a losing trial reverts" :revert (:decision outcome))
  (assert= "the seat returns to the permanent model" "anthropic/perm-model"
           (model-steward-trial-lib/seat-id (:seat outcome)))
  (assert= "the loss is recorded once" 1 (count (model-steward-trial-lib/losers-for-role trials "coder")))
  (assert= "the loss records the evidence it lost with" "scorecards/first.json"
           (:evidence (first (model-steward-trial-lib/losers-for-role trials "coder"))))

  ;; ...and against silent re-trial:
  (let [same (model-steward-trial-lib/nominate trials reg "coder"
                                               (assoc candidate :evidence "scorecards/first.json")
                                               permanent "2026-09-01T09:00:00Z")
        bare (model-steward-trial-lib/nominate trials reg "coder" candidate permanent "2026-09-01T09:00:00Z")
        fresh (model-steward-trial-lib/nominate trials reg "coder"
                                                (assoc candidate :evidence "scorecards/second.json")
                                                permanent "2026-09-01T09:00:00Z")]
    (assert-true "re-trial on the SAME evidence is refused" (some? (:error same)))
    (assert-true "re-trial with NO evidence is refused" (some? (:error bare)))
    (assert= "re-trial on NEW evidence is allowed" nil (:error fresh))))

(let [out (model-steward-trial-lib/assess model-steward-trial-lib/empty-trials
                                          model-steward-lib/empty-registry "coder" t0)]
  (assert-true "assessing a role with no armed trial is refused" (some? (:error out))))

;; ── boundaries ────────────────────────────────────────────────────────────

(assert= "arming a trial crosses the start boundary" "trial-start"
         (model-steward-trial-lib/boundary-for :nominate {:from "a/1" :to "b/2"}))
(assert= "reverting crosses the end boundary" "trial-end"
         (model-steward-trial-lib/boundary-for :assess {:from "b/2" :to "a/1"}))
(assert= "a promotion changes no seat, so it owes no transfer" nil
         (model-steward-trial-lib/boundary-for :assess {:from "b/2" :to "b/2"}))

;; ── due? ──────────────────────────────────────────────────────────────────

(let [trial {:ends_at "2026-08-31T09:00:00Z"}]
  (assert-true "a trial is not due before its day elapses"
               (not (model-steward-trial-lib/due? trial "2026-08-31T08:59:59Z")))
  (assert-true "a trial is due at its end instant"
               (model-steward-trial-lib/due? trial "2026-08-31T09:00:00Z"))
  (assert-true "a trial is due after its day elapses"
               (model-steward-trial-lib/due? trial "2026-09-01T00:00:00Z")))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
