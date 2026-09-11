#!/usr/bin/env bb
;; TDD runner for branch_identity_guard_lib.bb (BL-1515) - pure assertions,
;; no git. Named per feature scenario.
(ns branch-identity-guard-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "branch_identity_guard_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

;; ── branch-identity-guard-01: on-declared-branch proceeds silently ─────────

(assert= "scenario 01: checked-out branch matches declared -> :ok"
         {:status :ok}
         (branch-identity-guard-lib/decide
          {:declared "swarmforge-coder" :actual "swarmforge-coder"
           :declared-ref-exists? true :declared-tip "aaa" :actual-tip "aaa"
           :origin-ref-exists? true :origin-tip-ancestor-of-actual? true
           :git-read-error? false}))

;; ── branch-identity-guard-02: declared ref absent, origin contained -> repair ─

(assert= "scenario 02: declared local ref absent and origin/<declared> is an ancestor of the checked-out tip -> :repair"
         {:status :repair :from "side" :to "swarmforge-coder"}
         (branch-identity-guard-lib/decide
          {:declared "swarmforge-coder" :actual "side"
           :declared-ref-exists? false :declared-tip nil :actual-tip "bbb"
           :origin-ref-exists? true :origin-tip-ancestor-of-actual? true
           :git-read-error? false}))

(assert= "declared local ref absent, no origin/<declared> ref at all -> :repair (nothing to be an ancestor of)"
         {:status :repair :from "side" :to "swarmforge-coder"}
         (branch-identity-guard-lib/decide
          {:declared "swarmforge-coder" :actual "side"
           :declared-ref-exists? false :declared-tip nil :actual-tip "bbb"
           :origin-ref-exists? false :origin-tip-ancestor-of-actual? false
           :git-read-error? false}))

;; ── branch-identity-guard-03: declared ref exists at a different tip -> refuse ─

(let [verdict (branch-identity-guard-lib/decide
               {:declared "swarmforge-coder" :actual "side"
                :declared-ref-exists? true :declared-tip "ccc" :actual-tip "ddd"
                :origin-ref-exists? true :origin-tip-ancestor-of-actual? false
                :git-read-error? false})]
  (assert= "scenario 03: declared ref exists at a different tip -> :refuse"
           :refuse (:status verdict))
  (assert= "scenario 03: reason names the declared-ref-present shape"
           "declared-ref-exists-at-a-different-tip" (:reason verdict))
  (assert= "scenario 03: both tips are carried for the report"
           {:declared-tip "ccc" :actual-tip "ddd"}
           (select-keys verdict [:declared-tip :actual-tip])))

;; ── branch-identity-guard-04: detached HEAD -> refuse ──────────────────────

(let [verdict (branch-identity-guard-lib/decide
               {:declared "swarmforge-coder" :actual "HEAD"
                :declared-ref-exists? true :declared-tip "eee" :actual-tip "eee"
                :origin-ref-exists? true :origin-tip-ancestor-of-actual? true
                :git-read-error? false})]
  (assert= "scenario 04: a detached HEAD is always :refuse, even if it happens to sit at the declared tip"
           :refuse (:status verdict))
  (assert= "scenario 04: reason names detached HEAD"
           "detached-head" (:reason verdict)))

;; ── branch-identity-guard-05: repair is idempotent ─────────────────────────

(assert= "scenario 05: after a rename, actual already equals declared -> :ok again (idempotent)"
         {:status :ok}
         (branch-identity-guard-lib/decide
          {:declared "swarmforge-coder" :actual "swarmforge-coder"
           :declared-ref-exists? true :declared-tip "bbb" :actual-tip "bbb"
           :origin-ref-exists? true :origin-tip-ancestor-of-actual? true
           :git-read-error? false}))

;; ── origin diverged: declared absent, origin exists but is NOT an ancestor ──

(let [verdict (branch-identity-guard-lib/decide
               {:declared "swarmforge-coder" :actual "side"
                :declared-ref-exists? false :declared-tip nil :actual-tip "fff"
                :origin-ref-exists? true :origin-tip-ancestor-of-actual? false
                :git-read-error? false})]
  (assert= "declared ref absent but origin/<declared> is NOT contained in the checked-out tip -> :refuse, never :repair"
           :refuse (:status verdict))
  (assert= "reason names the diverged-origin shape"
           "origin-tip-is-not-an-ancestor-of-the-checked-out-branch" (:reason verdict)))

;; ── a git-read failure always refuses, whatever the other facts say ────────

(assert= "a git-read error refuses even when every other fact looks like a safe repair"
         :refuse
         (:status (branch-identity-guard-lib/decide
                   {:declared "swarmforge-coder" :actual "side"
                    :declared-ref-exists? false :declared-tip nil :actual-tip nil
                    :origin-ref-exists? false :origin-tip-ancestor-of-actual? false
                    :git-read-error? true})))

;; ── repaired-line / refusal-line formatting ─────────────────────────────────

(assert= "repaired-line format"
         "BRANCH_DRIFT_REPAIRED role=coder from=side to=swarmforge-coder at=bbb"
         (branch-identity-guard-lib/repaired-line
          {:role "coder" :from "side" :to "swarmforge-coder" :at "bbb"}))

(assert= "refusal-line format names role, declared, actual, both tips and the reason"
         "BRANCH_DRIFT_DETECTED role=coder declared=swarmforge-coder actual=side declared_tip=ccc actual_tip=ddd reason=declared-ref-exists-at-a-different-tip"
         (branch-identity-guard-lib/refusal-line
          {:role "coder" :declared "swarmforge-coder" :actual "side"
           :declared-tip "ccc" :actual-tip "ddd"
           :reason "declared-ref-exists-at-a-different-tip"}))

(assert= "refusal-line prints \"absent\" for a missing declared tip (declared ref does not exist)"
         "BRANCH_DRIFT_DETECTED role=coder declared=swarmforge-coder actual=side declared_tip=absent actual_tip=fff reason=origin-tip-is-not-an-ancestor-of-the-checked-out-branch"
         (branch-identity-guard-lib/refusal-line
          {:role "coder" :declared "swarmforge-coder" :actual "side"
           :declared-tip nil :actual-tip "fff"
           :reason "origin-tip-is-not-an-ancestor-of-the-checked-out-branch"}))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: branch_identity_guard_lib.bb"))
