#!/usr/bin/env bb
;; TDD runner for batch_claim_progress_lib.bb — pure, no filesystem / tmux / network.

(ns batch-claim-progress-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "batch_claim_progress_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true  [msg actual] (assert= msg true  (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; ── sidecar path ─────────────────────────────────────────────────────────────

(assert= "sidecar-path appends .batch-claim-progress.json"
         "/tmp/foo.handoff.batch-claim-progress.json"
         (batch-claim-progress-lib/sidecar-path "/tmp/foo.handoff"))

;; ── make-batch-claim-progress ────────────────────────────────────────────────

(let [p (batch-claim-progress-lib/make-batch-claim-progress "cleaner" "BL-678" "abc1234567" 1000)]
  (assert= "make-batch-claim-progress: ownerRole set" "cleaner" (:ownerRole p))
  (assert= "make-batch-claim-progress: parcelId set" "BL-678" (:parcelId p))
  (assert= "make-batch-claim-progress: claimAtMs set" 1000 (:claimAtMs p))
  (assert= "make-batch-claim-progress: lastProgressAtMs starts equal to claimAtMs" 1000 (:lastProgressAtMs p))
  (assert= "make-batch-claim-progress: lastCommit set" "abc1234567" (:lastCommit p)))

(let [p (batch-claim-progress-lib/make-batch-claim-progress "cleaner" "BL-678" nil 1000)]
  (assert= "make-batch-claim-progress: nil commit defaults to empty string" "" (:lastCommit p)))

;; ── advanced? ────────────────────────────────────────────────────────────────

(assert-true "advanced?: different non-blank commit is an advance"
             (batch-claim-progress-lib/advanced? {:lastCommit "aaa1111111"} "bbb2222222"))
(assert-false "advanced?: same commit is not an advance"
              (batch-claim-progress-lib/advanced? {:lastCommit "aaa1111111"} "aaa1111111"))
(assert-false "advanced?: blank current commit is never an advance"
              (batch-claim-progress-lib/advanced? {:lastCommit "aaa1111111"} ""))
(assert-false "advanced?: nil current commit is never an advance"
              (batch-claim-progress-lib/advanced? {:lastCommit "aaa1111111"} nil))

;; ── mark-progress ────────────────────────────────────────────────────────────

(let [p (batch-claim-progress-lib/mark-progress
         {:ownerRole "cleaner" :parcelId "BL-678" :claimAtMs 1000 :lastProgressAtMs 1000 :lastCommit "aaa1111111"}
         "bbb2222222" 5000)]
  (assert= "mark-progress: lastProgressAtMs refreshed" 5000 (:lastProgressAtMs p))
  (assert= "mark-progress: lastCommit refreshed" "bbb2222222" (:lastCommit p))
  (assert= "mark-progress: claimAtMs untouched" 1000 (:claimAtMs p))
  (assert= "mark-progress: ownerRole untouched" "cleaner" (:ownerRole p)))

(let [p (batch-claim-progress-lib/mark-progress {:lastCommit "aaa1111111"} nil 5000)]
  (assert= "mark-progress: nil commit keeps the prior lastCommit" "aaa1111111" (:lastCommit p)))

;; ── progress-age-ms ──────────────────────────────────────────────────────────

(assert= "progress-age-ms: now minus lastProgressAtMs"
         4000
         (batch-claim-progress-lib/progress-age-ms {:lastProgressAtMs 1000 :claimAtMs 1000} 5000))
(assert= "progress-age-ms: falls back to claimAtMs when lastProgressAtMs absent"
         4000
         (batch-claim-progress-lib/progress-age-ms {:claimAtMs 1000} 5000))
(assert= "progress-age-ms: floors at 0 for a nil progress"
         0
         (batch-claim-progress-lib/progress-age-ms nil 5000))

;; ── fresh? ───────────────────────────────────────────────────────────────────

(assert-true "fresh?: age strictly under the threshold is fresh"
             (batch-claim-progress-lib/fresh? {:lastProgressAtMs 1000} 1500 1000))
(assert-false "fresh?: age at or over the threshold is not fresh"
              (batch-claim-progress-lib/fresh? {:lastProgressAtMs 1000} 2000 1000))
(assert-false "fresh?: nil progress is never fresh"
              (batch-claim-progress-lib/fresh? nil 2000 1000))

;; ── decide-batch-claim-observation ───────────────────────────────────────────

;; BL-1076 retired the dirt-blind arity these three called, so they now say
;; "clean worktree" out loud - which is the condition they always meant.
(assert= "decide: fresh progress -> :silent"
         :silent
         (batch-claim-progress-lib/decide-batch-claim-observation {:lastProgressAtMs 1000} 1500 1000 false))
(assert= "decide: stale progress -> :stale-suspect"
         :stale-suspect
         (batch-claim-progress-lib/decide-batch-claim-observation {:lastProgressAtMs 1000} 5000 1000 false))
(assert= "decide: nil progress (no sidecar) -> :silent, never surfaced as suspect"
         :silent
         (batch-claim-progress-lib/decide-batch-claim-observation nil 5000 1000 false))

;; ── BL-1076: per-role tolerance and the visible-work gate ───────────────────
;; One flat 20-minute clock judged every batch role, and HEAD movement was the
;; only progress signal. A hardener mid-Stryker breaks both at once: mutation
;; passes routinely run an hour before the first commit, with the work sitting
;; uncommitted in the worktree. Measured 2026-08-22 - three parcels surfaced as
;; suspect at 20:40:46Z and again at 21:10:48Z while the owner was demonstrably
;; working (`M extension/test/boyScoutRun.test.js`).

(assert= "bl1076: the built-in role map grants hardender 90 minutes"
         (* 90 60 1000)
         (get batch-claim-progress-lib/role-stale-threshold-ms "hardender"))

(assert= "bl1076: a role with no entry falls back to the configured base"
         (* 20 60 1000)
         (batch-claim-progress-lib/resolve-stale-threshold-ms "cleaner" (* 20 60 1000) nil))

(assert= "bl1076: the built-in role entry beats the base for that role"
         (* 90 60 1000)
         (batch-claim-progress-lib/resolve-stale-threshold-ms "hardender" (* 20 60 1000) nil))

(assert= "bl1076: an operator override beats the built-in role entry"
         (* 2 60 1000)
         (batch-claim-progress-lib/resolve-stale-threshold-ms
          "hardender" (* 20 60 1000) {"hardender" (* 2 60 1000)}))

(assert= "bl1076: an override for a DIFFERENT role does not leak onto this one"
         (* 20 60 1000)
         (batch-claim-progress-lib/resolve-stale-threshold-ms
          "cleaner" (* 20 60 1000) {"hardender" (* 2 60 1000)}))

(assert= "bl1076: an override for a role with a built-in entry still degrades to that entry when absent"
         (* 90 60 1000)
         (batch-claim-progress-lib/resolve-stale-threshold-ms
          "hardender" (* 20 60 1000) {"cleaner" (* 2 60 1000)}))

;; ── the third label ─────────────────────────────────────────────────────────
;; Suppression is only reachable where a suspect note WOULD have gone out.
;; Fresh progress has nothing to suppress, so it stays :silent - invariant 2
;; ("no suppression is silent") is about observations the sweep DECLINES to
;; surface, not about ones it never had.

(assert= "bl1076-01: stale progress with a dirty worktree is suppressed, not surfaced"
         :suppressed-visible-work
         (batch-claim-progress-lib/decide-batch-claim-observation
          {:lastProgressAtMs 1000} 5000 1000 true))

(assert= "bl1076-01: stale progress with a clean worktree is still surfaced"
         :stale-suspect
         (batch-claim-progress-lib/decide-batch-claim-observation
          {:lastProgressAtMs 1000} 5000 1000 false))

(assert= "bl1076: fresh progress with a dirty worktree is silent, never 'suppressed'"
         :silent
         (batch-claim-progress-lib/decide-batch-claim-observation
          {:lastProgressAtMs 1000} 1500 1000 true))

(assert= "bl1076: no sidecar with a dirty worktree is silent, never 'suppressed'"
         :silent
         (batch-claim-progress-lib/decide-batch-claim-observation nil 5000 1000 true))

;; The dirt-blind arity is RETIRED rather than left defaulting to false: a call
;; site that forgot the flag would silently lose the suppression gate, which is
;; this defect over again in a new place (same reasoning as BL-1043's retired
;; grace-less arity).
(assert-true "bl1076: the dirt-blind 3-arity no longer resolves"
             (try (batch-claim-progress-lib/decide-batch-claim-observation
                   {:lastProgressAtMs 1000} 5000 1000)
                  false
                  ;; The message differs between a single-arity fn ("Wrong
                  ;; number of args (3)") and a multi-arity one ("with 3
                  ;; arguments"), so both spellings count - but it is pinned
                  ;; either way, so an unrelated throw cannot read as the
                  ;; arity being gone.
                  (catch Exception e
                    (boolean (re-find #"with 3 arguments|Wrong number of args \(3\)"
                                      (str (.getMessage e)))))))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str "\n" (count @failures) " failure(s)"))
  (System/exit 1))

(println "batch_claim_progress_lib_test_runner: ok")
