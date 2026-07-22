#!/usr/bin/env bb
;; TDD runner for claim_progress_lib.bb — pure, no filesystem / tmux / network.

(ns claim-progress-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "claim_progress_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true  [msg actual] (assert= msg true  (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; ── sidecar path ─────────────────────────────────────────────────────────────

(assert= "sidecar-path appends .claim-progress.json"
         "/tmp/foo.handoff.claim-progress.json"
         (claim-progress-lib/claim-progress-sidecar-path "/tmp/foo.handoff"))

;; ── make-claim-progress ──────────────────────────────────────────────────────

(let [p (claim-progress-lib/make-claim-progress "abc1234567" 1000)]
  (assert= "make-claim-progress: claimCommit set" "abc1234567" (:claimCommit p))
  (assert= "make-claim-progress: claimAtMs set" 1000 (:claimAtMs p))
  (assert= "make-claim-progress: reclaims starts at 0" 0 (:reclaims p)))

;; ── increment-reclaims ───────────────────────────────────────────────────────

(assert= "increment-reclaims from 0 → 1" 1
         (:reclaims (claim-progress-lib/increment-reclaims {:reclaims 0})))
(assert= "increment-reclaims from 2 → 3" 3
         (:reclaims (claim-progress-lib/increment-reclaims {:reclaims 2})))
(assert= "increment-reclaims nil reclaims → 1" 1
         (:reclaims (claim-progress-lib/increment-reclaims {})))

;; ── classify-claim-progress ──────────────────────────────────────────────────

(let [base-ms 0
      timeout-ms (* 5 60 1000)
      cfg {:claim-idle-timeout-ms timeout-ms
           :bounce-threshold 3
           :halt-threshold 5}
      claimed-commit "aaaa000000"
      advanced-commit "bbbb111111"]

  (assert= "classify: new commit → :progressed"
           :progressed
           (claim-progress-lib/classify-claim-progress
            {:claimCommit claimed-commit :claimAtMs base-ms :reclaims 0}
            advanced-commit
            (+ base-ms 1000)
            cfg))

  (assert= "classify: same commit, within timeout → :not-yet-overdue"
           :not-yet-overdue
           (claim-progress-lib/classify-claim-progress
            {:claimCommit claimed-commit :claimAtMs base-ms :reclaims 0}
            claimed-commit
            (+ base-ms (dec timeout-ms))
            cfg))

  (assert= "classify: same commit, AT timeout → :claimed-idle"
           :claimed-idle
           (claim-progress-lib/classify-claim-progress
            {:claimCommit claimed-commit :claimAtMs base-ms :reclaims 0}
            claimed-commit
            (+ base-ms timeout-ms)
            cfg))

  (assert= "classify: same commit, PAST timeout → :claimed-idle"
           :claimed-idle
           (claim-progress-lib/classify-claim-progress
            {:claimCommit claimed-commit :claimAtMs base-ms :reclaims 0}
            claimed-commit
            (+ base-ms timeout-ms 60000)
            cfg))

  (assert= "classify: blank current commit (worktree git error) → :not-yet-overdue within timeout"
           :not-yet-overdue
           (claim-progress-lib/classify-claim-progress
            {:claimCommit claimed-commit :claimAtMs base-ms :reclaims 0}
            ""
            (+ base-ms 1000)
            cfg))

  (assert= "classify: blank current commit past timeout → :claimed-idle"
           :claimed-idle
           (claim-progress-lib/classify-claim-progress
            {:claimCommit claimed-commit :claimAtMs base-ms :reclaims 0}
            ""
            (+ base-ms timeout-ms 1)
            cfg))

  (assert= "classify: both blank → :not-yet-overdue within timeout (blank≠blank guard)"
           :not-yet-overdue
           (claim-progress-lib/classify-claim-progress
            {:claimCommit "" :claimAtMs base-ms :reclaims 0}
            ""
            (+ base-ms 1000)
            cfg)))

;; ── decide-claim-idle-action ─────────────────────────────────────────────────

(let [cfg claim-progress-lib/default-config]
  (assert= "decide: reclaims=1 (at nudge-threshold=1) → :nudge"
           :nudge
           (claim-progress-lib/decide-claim-idle-action 1 cfg))

  (assert= "decide: reclaims=2 → :nudge (below bounce)"
           :nudge
           (claim-progress-lib/decide-claim-idle-action 2 cfg))

  (assert= "decide: reclaims=5 → :nudge (below bounce)"
           :nudge
           (claim-progress-lib/decide-claim-idle-action 5 cfg))

  (assert= "decide: reclaims=6 (at bounce-threshold=6) → :bounce"
           :bounce
           (claim-progress-lib/decide-claim-idle-action 6 cfg))

  (assert= "decide: reclaims=9 → :bounce"
           :bounce
           (claim-progress-lib/decide-claim-idle-action 9 cfg))

  (assert= "decide: reclaims=10 (at halt-threshold=10) → :halt"
           :halt
           (claim-progress-lib/decide-claim-idle-action 10 cfg)))

;; custom thresholds
(let [cfg {:nudge-threshold 2 :bounce-threshold 4 :halt-threshold 6}]
  (assert= "decide (custom): reclaims=1 < nudge-threshold=2 → :nudge"
           :nudge
           (claim-progress-lib/decide-claim-idle-action 1 cfg))
  (assert= "decide (custom): reclaims=4 → :bounce"
           :bounce
           (claim-progress-lib/decide-claim-idle-action 4 cfg))
  (assert= "decide (custom): reclaims=6 → :halt"
           :halt
           (claim-progress-lib/decide-claim-idle-action 6 cfg)))

;; ── alert formatting ──────────────────────────────────────────────────────────

(assert-true "format-halt-reason names the role and reclaims"
             (let [s (claim-progress-lib/format-halt-reason "coder" 5)]
               (and (re-find #"coder" s) (re-find #"5" s) (re-find #"(?i)halt" s))))

(assert-true "format-email-subject names the role"
             (boolean (re-find #"coder" (claim-progress-lib/format-email-subject "coder"))))

(assert-true "format-telegram-alert names role and HALTED"
             (let [s (claim-progress-lib/format-telegram-alert "coder" 5)]
               (and (re-find #"coder" s) (re-find #"5" s) (re-find #"(?i)halt" s))))

(assert-true "format-bounce-log names role and reclaims"
             (let [s (claim-progress-lib/format-bounce-log "coder" 3)]
               (and (re-find #"coder" s) (re-find #"3" s) (re-find #"(?i)bounce" s))))

;; ── escalation ladder full sequence ──────────────────────────────────────────

(let [claim-ms 0
      timeout-ms (* 5 60 1000)
      commit "aaaa000000"
      cfg {:claim-idle-timeout-ms timeout-ms
           :nudge-threshold 1
           :bounce-threshold 3
           :halt-threshold 5}
      p0 (claim-progress-lib/make-claim-progress commit claim-ms)

      ;; Three consecutive idle reclaim observations
      classify (fn [progress now]
                 (claim-progress-lib/classify-claim-progress
                  progress commit (+ claim-ms timeout-ms now) cfg))
      decide (fn [progress]
               (let [p' (claim-progress-lib/increment-reclaims progress)]
                 {:action (claim-progress-lib/decide-claim-idle-action (:reclaims p') cfg)
                  :progress p'}))]

  (let [c0 (classify p0 0)]
    (assert= "ladder: first observe → :claimed-idle" :claimed-idle c0))

  (let [{a1 :action p1 :progress} (decide p0)]
    (assert= "ladder: reclaims=1 → :nudge" :nudge a1)

    (let [{a2 :action p2 :progress} (decide p1)]
      (assert= "ladder: reclaims=2 → :nudge" :nudge a2)

      (let [{a3 :action p3 :progress} (decide p2)]
        (assert= "ladder: reclaims=3 → :bounce" :bounce a3)

        (let [{a4 :action p4 :progress} (decide p3)]
          (assert= "ladder: reclaims=4 → :bounce" :bounce a4)

          (let [{a5 :action _p5 :progress} (decide p4)]
            (assert= "ladder: reclaims=5 → :halt" :halt a5)))))))

;; ── evaluate-claim-idle-signal (probe + activity gates) ─────────────────────

(let [timeout-ms 1000
      cfg {:claim-idle-timeout-ms timeout-ms :probe-grace-ms 500}
      commit "aaaa000000"
      base {:claimCommit commit :claimAtMs 0 :reclaims 0}
      past (+ timeout-ms 100)
      idle-ctx {:role "coder" :agent-busy? false :worktree-dirty? false
                :resident-busy? false :resident-recently-active? false
                :active-role "coder" :rotation-router? false}]

  (assert= "hardender timeout is 90min"
           (* 90 60 1000)
           (claim-progress-lib/resolve-claim-idle-timeout-ms "hardender" {}))

  (assert= "mono-router stale coder claim while hardender active → paused"
           :paused-dormant
           (claim-progress-lib/evaluate-claim-idle-signal base commit past cfg
                                                          (assoc idle-ctx
                                                                 :role "coder"
                                                                 :active-role "hardender"
                                                                 :rotation-router? true)))

  (assert= "resident busy skips reclaim for any role"
           :not-yet-overdue
           (claim-progress-lib/evaluate-claim-idle-signal base commit past cfg
                                                          (assoc idle-ctx :resident-busy? true)))

  (assert= "busy agent skips reclaim"
           :not-yet-overdue
           (claim-progress-lib/evaluate-claim-idle-signal base commit past cfg
                                                          (assoc idle-ctx :agent-busy? true)))

  (assert= "dirty worktree skips reclaim"
           :not-yet-overdue
           (claim-progress-lib/evaluate-claim-idle-signal base commit past cfg
                                                          (assoc idle-ctx :worktree-dirty? true)))

  (assert= "first overdue → probe before reclaim"
           :probe-agent
           (claim-progress-lib/evaluate-claim-idle-signal base commit past cfg idle-ctx))

  (assert= "within probe grace → not yet"
           :not-yet-overdue
           (claim-progress-lib/evaluate-claim-idle-signal
            (claim-progress-lib/mark-idle-probe base 900) commit past cfg idle-ctx))

  (assert= "after probe grace → claimed-idle"
           :claimed-idle
           (claim-progress-lib/evaluate-claim-idle-signal
            (claim-progress-lib/mark-idle-probe base 400) commit past cfg idle-ctx))

  (assert= "legacy reclaims>0 without probe → claimed-idle"
           :claimed-idle
           (claim-progress-lib/evaluate-claim-idle-signal
            {:claimCommit commit :claimAtMs 0 :reclaims 3} commit past cfg idle-ctx))

  (assert-true "should-refuse halt for stale dormant coder claim"
               (claim-progress-lib/should-refuse-claim-halt?
                {:role "coder" :active-role "hardender" :rotation-router? true
                 :resident-busy? false :resident-recently-active? false})))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))
(println "PASS claim_progress_lib assertions")
