#!/usr/bin/env bb
;; TDD runner for babysitter_lib.bb — no tmux, no clock, no network.
(ns babysitter-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitter_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

;; ── timer due ───────────────────────────────────────────────────────────────
(assert-true "first observe is due when never run"
             (babysitter-lib/next-observe-due? 1000 nil 1200000))
(assert-true "not due before interval"
             (not (babysitter-lib/next-observe-due? 1000 500 1200000)))
(assert-true "due after interval"
             (babysitter-lib/next-observe-due? 1201500 1000 1200000))

;; ── should-fire ─────────────────────────────────────────────────────────────
(assert-true "timer alone fires"
             (babysitter-lib/should-fire-observe?
              {:now-ms 1201500 :last-observe-ms 1000 :interval-ms 1200000
               :pending-count 0 :debounce-ms 0}))
(assert-true "pending handoff fires even if timer not due"
             (babysitter-lib/should-fire-observe?
              {:now-ms 2000 :last-observe-ms 1000 :interval-ms 1200000
               :pending-count 2 :debounce-ms 0}))
(assert-true "debounce blocks rapid re-fire"
             (not (babysitter-lib/should-fire-observe?
                   {:now-ms 5000 :last-observe-ms 1000 :interval-ms 1200000
                    :pending-count 3 :debounce-ms 30000 :last-fire-ms 4000})))
(assert-true "idle green does not fire"
             (not (babysitter-lib/should-fire-observe?
                   {:now-ms 5000 :last-observe-ms 1000 :interval-ms 1200000
                    :pending-count 0 :debounce-ms 0})))

;; ── reason + message ────────────────────────────────────────────────────────
(assert= "handoff beats timer"
         :handoff
         (babysitter-lib/classify-wake-reason [{:type "handoff"}] true))
(assert= "timer when no events"
         :timer
         (babysitter-lib/classify-wake-reason [] true))

(let [msg (babysitter-lib/format-wake-message
           :handoff
           [(babysitter-lib/handoff-wake-event
             {:from "coder" :to "cleaner" :path "/x.handoff" :task "BL-1"})])]
  (assert-true "message names handoff wake" (str/includes? msg "WAKE [handoff]"))
  (assert-true "message cites from=" (str/includes? msg "from=coder"))
  (assert-true "message tells idle after one pass" (str/includes? msg "idle at >"))
  (assert-true "message forbids self-schedule" (str/includes? msg "do NOT self-schedule")))

;; ── queue parse ─────────────────────────────────────────────────────────────
(assert= "parses jsonl"
         [{:type "handoff" :from "QA"}]
         (babysitter-lib/parse-wake-queue "{\"type\":\"handoff\",\"from\":\"QA\"}\n"))
(assert= "skips bad lines"
         [{:type "handoff"}]
         (babysitter-lib/parse-wake-queue "not-json\n{\"type\":\"handoff\"}\n"))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "babysitter_lib_test_runner: ok")
