#!/usr/bin/env bb
;; TDD runner for swarm_status_lib.bb — pure, no I/O.
(ns swarm-status-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "swarm_status_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

;; ── header parse ────────────────────────────────────────────────────────────
(let [h (swarm-status-lib/parse-envelope-headers
         "from: coder\nto: QA\ntask: BL-526\n\nbody\n")]
  (assert= "from" "coder" (get h "from"))
  (assert= "to" "QA" (get h "to"))
  (assert= "task" "BL-526" (get h "task")))

;; ── summarize prefers task over message ─────────────────────────────────────
(let [s (swarm-status-lib/summarize-handoff
         "from: specifier\nto: coder\ntype: git_handoff\ntask: BL-526\nmessage: ignore me\ncreated_at: 2026-07-18T23:24:18Z\n\nbody\n"
         {:mtime-iso "fallback" :path "/x.handoff"})]
  (assert= "ticket from task" "BL-526" (:ticket s))
  (assert= "from" "specifier" (:from s))
  (assert= "to" "coder" (:to s))
  (assert= "at created_at" "2026-07-18T23:24:18Z" (:at s)))

(let [s (swarm-status-lib/summarize-handoff
         "from: coordinator\nto: specifier\ntype: note\nmessage: Spec BL-528 auto-heal\ncreated_at: 2026-07-19T11:55:23Z\n\n"
         {})]
  (assert= "ticket from message" "Spec BL-528 auto-heal" (:ticket s)))

;; ── relative ago ────────────────────────────────────────────────────────────
(assert= "just now" "just now" (swarm-status-lib/format-ago-ms 15000))
(assert= "mins" "5 mins ago" (swarm-status-lib/format-ago-ms (* 5 60 1000)))
(assert= "hours decimal" "1.5 hours ago" (swarm-status-lib/format-ago-ms (* 90 60 1000)))
(assert= "days decimal" "2.0 days ago" (swarm-status-lib/format-ago-ms (* 48 3600 1000)))

(let [now (.toEpochMilli (java.time.Instant/parse "2026-07-19T12:55:23Z"))
      s (swarm-status-lib/summarize-handoff
         "from: coordinator\nto: specifier\ntype: note\nmessage: Spec BL-528\ncreated_at: 2026-07-19T11:55:23Z\n\n"
         {:now-ms now})]
  (assert= "ago on summary" "1.0 hours ago" (:ago s)))

(let [line (swarm-status-lib/format-handoff-line
            {:ago "12 mins ago" :from "a" :to "b" :type "note" :ticket "BL-1"})]
  (assert-true "line uses ago" (str/includes? line "12 mins ago"))
  (assert-true "line still has route" (str/includes? line "a → b")))

;; ── duration ────────────────────────────────────────────────────────────────
(assert= "seconds" "45s" (swarm-status-lib/format-duration-ms 45000))
(assert= "minutes" "2m 5s" (swarm-status-lib/format-duration-ms (+ (* 2 60 1000) 5000)))
(assert= "hours" "1h 30m" (swarm-status-lib/format-duration-ms (* 90 60 1000)))
(assert= "days" "2d 3h 4m" (swarm-status-lib/format-duration-ms
                            (+ (* 2 86400 1000) (* 3 3600 1000) (* 4 60 1000))))

(assert= "uptime from started"
         "1h 0m"
         (swarm-status-lib/uptime-from-started-ms 3600000 0))

(assert= "tmux epoch uptime"
         "10s"
         (swarm-status-lib/uptime-from-epoch-sec 20000 10))

;; ── agent / daemon rows ─────────────────────────────────────────────────────
(let [row (swarm-status-lib/agent-status-row
           {:role "coder" :session "swarmforge-coder" :agent "aider"
            :alive? false :dormant? true :now-ms 1000})]
  (assert= "explicit dormant" :dormant (:status row)))

(let [row (swarm-status-lib/agent-status-row
           {:role "coder" :session "swarmforge-coder" :agent "aider"
            :alive? false :now-ms 1000})]
  (assert= "missing session is down" :down (:status row)))

(let [row (swarm-status-lib/agent-status-row
           {:role "QA" :session "swarmforge-QA" :agent "aider"
            :alive? true :created-epoch-sec 0 :now-ms 60000})]
  (assert= "alive agent up" :up (:status row))
  (assert= "uptime 1m" "1m 0s" (:uptime row)))

(assert= "daemon down"
         :down
         (:status (swarm-status-lib/daemon-status-row {:name "handoffd" :alive? false})))

;; ── render ──────────────────────────────────────────────────────────────────
(let [text (swarm-status-lib/render-status-report
            {:project-root "/repo"
             :generated-at "2026-07-19T12:00:00Z"
             :agents [{:name "QA" :status :up :uptime "1h 0m" :detail "session=swarmforge-QA"}]
             :daemons [{:name "handoffd" :status :up :uptime "2m 0s" :detail "pid=1"}]
             :telegram [{:name "bridge" :status :up :uptime "1d 0h 0m" :detail "pid=2"}]
             :handoffs [{:ago "12 mins ago" :from "coordinator" :to "specifier"
                         :type "note" :ticket "Spec BL-528"}]})]
  (assert-true "has Agents section" (str/includes? text "Agents"))
  (assert-true "has Daemons section" (str/includes? text "Daemons"))
  (assert-true "has Telegram section" (str/includes? text "Telegram bridge"))
  (assert-true "has Recent handoffs" (str/includes? text "Recent handoffs"))
  (assert-true "shows handoff route" (str/includes? text "coordinator → specifier"))
  (assert-true "shows UP agent" (str/includes? text "UP"))
  (assert-true "shows ticket" (str/includes? text "Spec BL-528"))
  (assert-true "shows relative ago" (str/includes? text "12 mins ago")))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "swarm_status_lib_test_runner: ok")
