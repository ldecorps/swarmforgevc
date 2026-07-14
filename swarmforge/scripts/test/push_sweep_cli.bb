#!/usr/bin/env bb
;; BL-356 acceptance test seam: drives the REAL push_sweep_lib.bb/sweep!
;; against a real fixture daemon-dir, with an explicit now-ms (no real
;; clock) and forced rev-counts/push/alarm results (no real git process, no
;; real network) - mirrors stuck_escalation_email_sweep_cli.bb's own
;; posture exactly. The one genuinely-real-git, real-network wiring proof
;; (that handoffd.bb's actual adapters call real `git fetch`/`git push`/
;; daemon_alarm_lib.bb) is a manual/E2E concern for QA against a live repo
;; and remote, not re-run per scenario here.
;;
;; Usage: push_sweep_cli.bb <daemon-dir> <now-ms>
;; Env:
;;   PUSH_SWEEP_REV_COUNTS       required. JSON {"ahead": int, "behind": int}
;;   PUSH_SWEEP_PUSH_RESULT      JSON send result for the push attempt
;;                                (required whenever ahead>0 and a push is
;;                                actually due this call)
;;   PUSH_SWEEP_ALARM_RESULT     JSON send result for the push-failure alarm
;;                                (required whenever the push alarm is
;;                                actually due this call)
;;   PUSH_SWEEP_DIVERGENCE_RESULT JSON send result for the divergence alarm
;;                                (required whenever the divergence alarm is
;;                                actually due this call)
;;   PUSH_TEST_MAX_PUSH_ATTEMPTS / _MAX_ALARM_ATTEMPTS / _BACKOFF_BASE_MS /
;;   _BACKOFF_MAX_MS              override the retry-config (test-friendly
;;                                small defaults)
;;
;; Prints one JSON line: {"state": <push-sweep-state.json contents>,
;; "pushCalls": N, "alarmCalls": N, "divergenceCalls": N, "logLines": [...]}
;; - the call counts reflect ONLY this single invocation's own actions, not
;; a cumulative total.

(ns push-sweep-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "push_sweep_lib.bb")))

(def daemon-dir (nth *command-line-args* 0))
(def now-ms (parse-long (nth *command-line-args* 1)))

(def retry-config
  {:max-push-attempts (or (some-> (System/getenv "PUSH_TEST_MAX_PUSH_ATTEMPTS") parse-long) 3)
   :max-alarm-attempts (or (some-> (System/getenv "PUSH_TEST_MAX_ALARM_ATTEMPTS") parse-long) 3)
   :backoff-base-ms (or (some-> (System/getenv "PUSH_TEST_BACKOFF_BASE_MS") parse-long) 1000)
   :backoff-max-ms (or (some-> (System/getenv "PUSH_TEST_BACKOFF_MAX_MS") parse-long) 8000)})

;; json/parse-string's keywordize-keys arg only keywordizes MAP KEYS, never
;; VALUES - a real result carries :reason as an actual Clojure keyword, so a
;; JSON-round-tripped "missing-api-key" STRING value must be turned back
;; into that keyword here, or classify-send-result's own set-membership
;; check silently never matches (same fix stuck_escalation_email_sweep_cli.bb
;; already applies).
(defn parse-forced-result [json-str]
  (let [parsed (json/parse-string json-str true)]
    (cond-> parsed
      (string? (:reason parsed)) (update :reason keyword))))

(defn env-json [name]
  (some-> (System/getenv name) parse-forced-result))

(def push-calls (atom 0))
(def alarm-calls (atom 0))
(def divergence-calls (atom 0))
(def log-lines (atom []))

(def rev-counts
  (or (some-> (System/getenv "PUSH_SWEEP_REV_COUNTS") (json/parse-string true))
      (throw (ex-info "PUSH_SWEEP_REV_COUNTS not set - no real git process is ever allowed here" {}))))

(defn push! []
  (swap! push-calls inc)
  (or (env-json "PUSH_SWEEP_PUSH_RESULT")
      (throw (ex-info "PUSH_SWEEP_PUSH_RESULT not set - no real git process is ever allowed here" {}))))

(defn send-push-alarm! [_attempts]
  (swap! alarm-calls inc)
  (or (env-json "PUSH_SWEEP_ALARM_RESULT")
      (throw (ex-info "PUSH_SWEEP_ALARM_RESULT not set - no real network call is ever allowed here" {}))))

(defn send-divergence-alarm! [_ahead _behind]
  (swap! divergence-calls inc)
  (or (env-json "PUSH_SWEEP_DIVERGENCE_RESULT")
      (throw (ex-info "PUSH_SWEEP_DIVERGENCE_RESULT not set - no real network call is ever allowed here" {}))))

(fs/create-dirs daemon-dir)
(push-sweep-lib/sweep!
 now-ms daemon-dir retry-config
 {:rev-counts! (fn [] rev-counts)
  :push! push!
  :send-push-alarm! send-push-alarm!
  :send-divergence-alarm! send-divergence-alarm!
  :log! (fn [& parts] (swap! log-lines conj (str/join " " parts)))})

(println
 (json/generate-string
  {:state (push-sweep-lib/read-state daemon-dir)
   :pushCalls @push-calls
   :alarmCalls @alarm-calls
   :divergenceCalls @divergence-calls
   :logLines @log-lines}))
