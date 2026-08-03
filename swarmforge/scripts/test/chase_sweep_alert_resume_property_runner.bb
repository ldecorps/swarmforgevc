#!/usr/bin/env bb
;; BL-795 coder pass (BL-654 Invariants): PROPERTY test over
;; chase_sweep_lib.bb's sweep-in-process!, encoding the ticket's third
;; declared invariant:
;;
;;   "Once stuck in_process work arms the chase alert / escalation, resume
;;    attempts continue; escalation does not permanently abandon a dormant
;;    mono-router holder."
;;
;; decide-stuck-action is the pure classifier (idle-seconds/nudge-count/
;; config -> "skipped"|"nudge"|"alert"); this property drives sweep-in-process!
;; (the orchestration wired to it) with a real temp in_process fixture and
;; fake adapters, across many generated (nudge-count, idle-seconds) pairs, and
;; asserts that whenever decide-stuck-action's OWN verdict for that input is
;; "alert", sweep-in-process! both (a) calls on-stuck-escalation! with true
;; and (b) still attempts a resume wake (send-wake-up!) AND advances the
;; nudge sidecar's count - "keeps waking", not merely "logs a wake attempt".
;; This generalizes test_chase_sweep.sh scenario 06's single fixture
;; (nudgeCount 3, one fixed idle offset) to every nudge-count/idle-seconds
;; combination decide-stuck-action can classify as "alert", including ones
;; no hand-written example reaches (e.g. nudge-count far past maxChases, or
;; idle-seconds only barely past the stuck threshold).
;;
;; Deterministic by construction: a seeded LCG, never rand (mirrors
;; mono_router_lib_property_runner.bb's own generator shape). Real temp
;; directories are used (babashka.fs), not mocked fs - chase_sweep_lib.bb is
;; a testable module per Design And Testability (no VS Code/webview/live
;; tmux-PTY dependency; wake/escalation/telemetry are all adapter-injected).
;;
;; Non-vacuity proven by hand at authoring time: ran this property against a
;; deliberately broken sweep-in-process! where the "alert" case dropped the
;; trailing (apply-stuck-nudge! ...) call (escalate-only, matching the
;; pre-fix behavior this ticket replaces) - every "alert"-classified run
;; failed on the "resume wake attempted" assertion, then the file was
;; restored to the adopted fix before this commit.

(ns chase-sweep-alert-resume-property-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(def now-ms (.toEpochMilli (java.time.Instant/parse "2026-08-03T20:00:00Z")))
(def role "coder")
(def config {:chaseIntervalSeconds 5 :stuckInProcessTimeoutSeconds 60 :maxChases 3})

;; ── seeded generator (mirrors mono_router_lib_property_runner.bb) ─────────

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

;; nudge-count: 0..7 (maxChases is 3, so this straddles well below/above it).
;; idle-margin-seconds: -40..+120 relative to stuckInProcessTimeoutSeconds
;; (60s), so idle-seconds ranges roughly 20s..180s - straddles the timeout
;; on both sides.
(defn gen-input [s]
  (let [[nudge-count s1] (gen-int s 8)
        [margin s2] (gen-int s1 161)]
    [{:nudge-count nudge-count :idle-margin (- margin 40)} s2]))

(defn- run-once! [{:keys [nudge-count idle-margin]}]
  (let [root (str (fs/create-temp-dir))
        ip-dir (str (fs/path root "in_process"))
        item-path (str (fs/path ip-dir "item.handoff"))
        idle-seconds (+ (:stuckInProcessTimeoutSeconds config) idle-margin)
        last-activity-ms (long (- now-ms (* idle-seconds 1000)))
        predicted (chase-sweep-lib/decide-stuck-action last-activity-ms nudge-count now-ms config)
        escalations (atom [])
        wakes (atom [])]
    (fs/create-dirs ip-dir)
    (spit item-path "id: t\nfrom: specifier\nto: coder\npriority: 50\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n")
    (when (pos? nudge-count)
      (spit (str item-path ".nudge") (json/generate-string {:nudgeCount nudge-count})))
    (let [adapters {:get-last-activity-ms (fn [_role] last-activity-ms)
                    :on-stuck-escalation! (fn [r escalated] (swap! escalations conj [r escalated]))
                    :send-wake-up! (fn [r] (swap! wakes conj r) true)
                    :log-telemetry! (fn [_event _now-ms] nil)
                    :get-role-head-commit nil
                    :role-agent-busy? nil
                    :role-worktree-dirty? nil}]
      (chase-sweep-lib/sweep-in-process! role ip-dir now-ms config adapters))
    (let [result {:predicted predicted
                  :escalations @escalations
                  :wakes @wakes
                  :nudge-count-after (if (fs/exists? (str item-path ".nudge"))
                                       (:nudgeCount (json/parse-string (slurp (str item-path ".nudge")) true))
                                       0)}]
      (fs/delete-tree root)
      result)))

(loop [i 0 s 7]
  (when (< i runs)
    (let [[input s'] (gen-input s)
          {:keys [predicted escalations wakes nudge-count-after] :as result} (run-once! input)]
      (when (= predicted "alert")
        (cond
          (not= [[role true]] escalations)
          (report! "P (invariant 3): alert always escalates true, exactly once" 7 input
                    (str "escalations=" (pr-str escalations)))

          (empty? wakes)
          (report! "P (invariant 3): alert still attempts a resume wake (escalation never permanently abandons a dormant holder)" 7 input
                    (str "wakes=" (pr-str wakes) " full-result=" (pr-str result)))

          (not= nudge-count-after (inc (:nudge-count input)))
          (report! "P (invariant 3): a delivered resume wake advances the nudge sidecar count" 7 input
                    (str "expected=" (inc (:nudge-count input)) " got=" nudge-count-after))))
      (recur (inc i) s'))))

;; ── generator coverage, asserted rather than assumed ─────────────────────

(let [alert-count (loop [i 0 s 7 n 0]
                     (if (= i runs)
                       n
                       (let [[input s'] (gen-input s)
                             idle-seconds (+ (:stuckInProcessTimeoutSeconds config) (:idle-margin input))
                             last-activity-ms (long (- now-ms (* idle-seconds 1000)))
                             predicted (chase-sweep-lib/decide-stuck-action last-activity-ms (:nudge-count input) now-ms config)]
                         (recur (inc i) s' (if (= predicted "alert") (inc n) n)))))
      floor (quot runs 20)]
  (println (str "  generator coverage: alert-classified=" alert-count "/" runs))
  (when (< alert-count floor)
    (report! "COVERAGE alert branch" 7 alert-count "alert branch barely exercised")))

(println (str "chase_sweep_lib alert-resume property: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
