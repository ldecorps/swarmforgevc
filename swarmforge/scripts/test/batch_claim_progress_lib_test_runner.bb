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

(assert= "decide: fresh progress -> :silent"
         :silent
         (batch-claim-progress-lib/decide-batch-claim-observation {:lastProgressAtMs 1000} 1500 1000))
(assert= "decide: stale progress -> :stale-suspect"
         :stale-suspect
         (batch-claim-progress-lib/decide-batch-claim-observation {:lastProgressAtMs 1000} 5000 1000))
(assert= "decide: nil progress (no sidecar) -> :silent, never surfaced as suspect"
         :silent
         (batch-claim-progress-lib/decide-batch-claim-observation nil 5000 1000))

;; ── within-cooldown? ─────────────────────────────────────────────────────────

(assert-true "within-cooldown?: last-sent-ms within window"
             (batch-claim-progress-lib/within-cooldown? 1000 1500 1000))
(assert-false "within-cooldown?: last-sent-ms outside window"
              (batch-claim-progress-lib/within-cooldown? 1000 3000 1000))
(assert-false "within-cooldown?: nil last-sent-ms is not within cooldown"
              (batch-claim-progress-lib/within-cooldown? nil 1500 1000))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str "\n" (count @failures) " failure(s)"))
  (System/exit 1))

(println "batch_claim_progress_lib_test_runner: ok")
