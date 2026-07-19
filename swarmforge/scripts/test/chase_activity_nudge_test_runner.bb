#!/usr/bin/env bb
;; Reproduce 2026-07-19 stuck-email floods from chase_sweep_lib:
;;   1) First pane observation after daemon start must NOT look like fresh activity
;;   2) A stuck nudge must NOT clear the escalation edge (re-arms the email)
;;
;; TDD: these assertions encode the observed failures. They must fail on the
;; accidentally-reverted chase_sweep_lib before the fix lands again.

(ns chase-activity-nudge-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-false [msg actual]
  (when actual
    (swap! failures conj (str "FAIL: " msg "\n  expected falsey, got: " (pr-str actual)))))

(chase-sweep-lib/reset-pane-activity!)

;; ── 01: first observation after daemon start is NOT fresh activity ─────────
;; Incident: every handoffd restart called track-pane-activity! with nil
;; previous → returned now-ms → "recently active" → cleared stuck-email arming
;; → still-stuck in_process role re-emailed the human (flood).
(let [outbox-ms 1000
      now-ms 999999
      observed (chase-sweep-lib/track-pane-activity! "specifier" "stale pane text" outbox-ms now-ms)]
  (assert= "01: first observation must keep outbox-activity-ms, never now-ms (daemon-restart flood)"
           outbox-ms observed))

;; Same content again: still not a fresh change.
(let [observed (chase-sweep-lib/track-pane-activity! "specifier" "stale pane text" 1000 2000000)]
  (assert= "01b: unchanged pane keeps the prior lastChangeMs floor"
           1000 observed))

;; Real content change DOES advance to now-ms.
(let [observed (chase-sweep-lib/track-pane-activity! "specifier" "agent typed something new" 1000 2000000)]
  (assert= "01c: a real pane-content change advances lastChangeMs to now-ms"
           2000000 observed))

(chase-sweep-lib/reset-pane-activity!)

;; ── 02: nudge must not clear on-stuck-escalation! ──────────────────────────
;; Incident: apply-stuck-nudge! called (on-stuck-escalation! role false), which
;; re-armed the stuck email on the next alert — especially under mono-router
;; where a dormant role's in_process can sit forever while chase wakes the
;; resident.
(let [dir (str (fs/create-temp-dir {:prefix "sfvc-nudge-no-clear-"}))
      _ (fs/create-dirs (fs/path dir "in_process"))
      path (str (fs/path dir "in_process" "00_item.handoff"))
      escalations (atom [])
      adapters {:send-wake-up! (fn [_])
                :log-telemetry! (fn [_ _])
                :on-stuck-escalation! (fn [role escalated?]
                                        (swap! escalations conj {:role role :escalated? escalated?}))
                :get-last-activity-ms (fn [_] 0)}]
  (spit path (str "id: t\nfrom: coder\nto: specifier\npriority: 50\ntype: note\n"
                  "message: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n"))
  ;; stuck enough to nudge (activity far in the past, nudgeCount 0)
  (chase-sweep-lib/sweep-in-process!
   "specifier" (str (fs/path dir "in_process")) 1000000
   {:stuckInProcessTimeoutSeconds 60 :maxChases 3}
   adapters)
  (assert-false "02: a stuck nudge must NOT call on-stuck-escalation! with false (email re-arm flood)"
                (some #(and (= "specifier" (:role %)) (false? (:escalated? %))) @escalations))
  (try (fs/delete-tree dir) (catch Exception _ nil)))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "chase_activity_nudge_test_runner: ALL TESTS PASSED")
