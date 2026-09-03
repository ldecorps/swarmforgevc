#!/usr/bin/env bb
;; BL-1352: TDD runner for the escalation transport's own visibility.
;; GH-25's escalation degraded to a status key nothing read and a log line
;; emitted once per tick forever (7027 of them) while two role slots sat
;; wedged. These are the two invariants that make that impossible again.

(ns bl1352-escalation-transport-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "role_ask_escalation_lib.bb")))
(load-file (str (fs/path script-dir ".." "swarm_status_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-includes [msg haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

;; ── invariant 1: the surface never reads healthy while a question waits ──

(let [s (role-ask-escalation-lib/escalation-transport-state
         {:transport :configured :waiting-roles []})]
  (assert= "configured with nothing waiting is ok" :ok (:state s)))

(let [s (role-ask-escalation-lib/escalation-transport-state
         {:transport :configured :waiting-roles ["specifier"]})]
  (assert= "configured with a question waiting is still ok" :ok (:state s)))

(let [s (role-ask-escalation-lib/escalation-transport-state
         {:transport :unconfigured :waiting-roles []})]
  (assert= "unconfigured with nothing waiting is a warning, not a red" :warn-unconfigured (:state s))
  (assert-includes "and says the transport is unconfigured" (:detail s) "unconfigured"))

(let [s (role-ask-escalation-lib/escalation-transport-state
         {:transport :unconfigured :waiting-roles ["specifier"]})]
  (assert= "unconfigured WITH a question waiting is a fault" :fault (:state s))
  (assert-includes "and the fault names the waiting role" (:detail s) "specifier"))

(let [s (role-ask-escalation-lib/escalation-transport-state
         {:transport :unconfigured :waiting-roles ["specifier" "coordinator"]})]
  (assert-includes "every waiting role is named, not just the first" (:detail s) "coordinator")
  (assert-includes "and the first one too" (:detail s) "specifier"))

;; ── invariant 2: logged on change only ───────────────────────────────────

(assert-true "a first observation logs"
             (role-ask-escalation-lib/transport-log-due? nil {:state :fault}))
(assert= "an unchanged state does not log again" false
         (role-ask-escalation-lib/transport-log-due? {:state "fault"} {:state :fault}))
(assert-true "a changed state logs once"
             (role-ask-escalation-lib/transport-log-due? {:state "fault"} {:state :ok}))
(assert= "and then holds quiet again" false
         (role-ask-escalation-lib/transport-log-due? {:state "ok"} {:state :ok}))

;; Ten ticks in one state produce exactly one line; a change produces one more.
(let [tick (fn [last state] (if (role-ask-escalation-lib/transport-log-due? last {:state state})
                              [{:state (name state)} 1]
                              [last 0]))
      [_ lines] (reduce (fn [[last n] state]
                          (let [[next-last emitted] (tick last state)]
                            [next-last (+ n emitted)]))
                        [nil 0]
                        (repeat 10 :fault))]
  (assert= "ten ticks in one state produce ONE line" 1 lines))

(let [tick (fn [last state] (if (role-ask-escalation-lib/transport-log-due? last {:state state})
                              [{:state (name state)} 1]
                              [last 0]))
      [_ lines] (reduce (fn [[last n] state]
                          (let [[next-last emitted] (tick last state)]
                            [next-last (+ n emitted)]))
                        [nil 0]
                        (concat (repeat 5 :fault) (repeat 5 :ok)))]
  (assert= "ten ticks that change state once produce TWO lines" 2 lines))

;; ── the status row itself ────────────────────────────────────────────────

(let [row (swarm-status-lib/ask-escalation-row
           {:state :fault :detail "unconfigured while specifier is waiting"})]
  (assert-includes "the row is labelled for a human" (:label row) "escalation")
  (assert= "and carries the state" :fault (:state row))
  (assert-includes "and the detail a human needs" (:detail row) "specifier"))

(let [report (swarm-status-lib/render-status-report
              {:project-root "/tmp/x" :agents [] :daemons [] :telegram [] :handoffs []
               :ask-escalation {:state :fault :detail "unconfigured while specifier is waiting"}})]
  (assert-includes "the rendered status names the ask escalation" report "escalation")
  (assert-includes "and shows the fault" report "specifier"))

(let [report (swarm-status-lib/render-status-report
              {:project-root "/tmp/x" :agents [] :daemons [] :telegram [] :handoffs []})]
  (assert-true "a report with no escalation data still renders" (string? report)))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: BL-1352 escalation transport visibility"))
