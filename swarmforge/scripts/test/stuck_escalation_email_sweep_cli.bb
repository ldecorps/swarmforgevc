#!/usr/bin/env bb
;; BL-349 acceptance test seam: drives the EXACT same two calls handoffd.bb's
;; real :on-stuck-escalation! adapter makes (write-escalation! then
;; stuck-escalation-email-sweep!'s own stuck-escalation-email-lib/sweep!),
;; against a real fixture daemon-dir, with an explicit now-ms (no real
;; clock) and a fake send-email! (no real network) - so the acceptance
;; suite drives the REAL wiring/state-persistence logic without needing a
;; real 60s-stuck daemon subprocess per scenario (that real end-to-end
;; wiring proof lives once, in test_handoffd_stuck_escalation_email_wiring.sh).
;;
;; Usage: stuck_escalation_email_sweep_cli.bb <daemon-dir> <role> <escalated?> <now-ms>
;; Env:
;;   STUCK_ESCALATION_EMAIL_FORCE_RESULT   JSON send result to return instead
;;                                          of a real send (required for any
;;                                          call where escalated?=true and a
;;                                          send is actually due)
;;   ESCALATION_TEST_MAX_ATTEMPTS / _BACKOFF_BASE_MS / _BACKOFF_MAX_MS
;;                                          override the retry-config (test-
;;                                          friendly small defaults)
;;
;; Prints one JSON line: {"state": <per-role state or null>, "sendCalls": N,
;; "escalationRecorded": bool} - sendCalls/escalationRecorded reflect ONLY
;; this single invocation's own actions, not a cumulative total.

(ns stuck-escalation-email-sweep-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "stuck_escalation_email_lib.bb")))

(def daemon-dir (nth *command-line-args* 0))
(def role (nth *command-line-args* 1))
(def escalated? (= "true" (nth *command-line-args* 2)))
(def now-ms (parse-long (nth *command-line-args* 3)))

(def retry-config
  {:max-attempts (or (some-> (System/getenv "ESCALATION_TEST_MAX_ATTEMPTS") parse-long) 3)
   :backoff-base-ms (or (some-> (System/getenv "ESCALATION_TEST_BACKOFF_BASE_MS") parse-long) 1000)
   :backoff-max-ms (or (some-> (System/getenv "ESCALATION_TEST_BACKOFF_MAX_MS") parse-long) 8000)})

(def send-calls (atom 0))
(def log-lines (atom []))

;; json/parse-string's keywordize-keys arg only keywordizes MAP KEYS, never
;; VALUES - a real send-alarm-email! result carries :reason as an actual
;; Clojure keyword (:missing-api-key etc), so a JSON-round-tripped
;; "missing-api-key" STRING value must be turned back into that keyword
;; here, or classify-delivery-result's own #{:disabled :missing-api-key
;; :test-fixture-suppressed} set membership check silently never matches.
(defn parse-force-result [json-str]
  (let [parsed (json/parse-string json-str true)]
    (cond-> parsed
      (string? (:reason parsed)) (update :reason keyword))))

(defn send-email! [_subject _text]
  (swap! send-calls inc)
  (if-let [forced (System/getenv "STUCK_ESCALATION_EMAIL_FORCE_RESULT")]
    (parse-force-result forced)
    (throw (ex-info "STUCK_ESCALATION_EMAIL_FORCE_RESULT not set - no real network call is ever allowed here" {}))))

(fs/create-dirs daemon-dir)
(chase-sweep-lib/write-escalation! daemon-dir role escalated?)
(stuck-escalation-email-lib/sweep!
 role escalated? now-ms daemon-dir retry-config
 {:send-email! send-email! :log! (fn [& parts] (swap! log-lines conj (str/join " " parts)))})

(println
 (json/generate-string
  {:state (get (stuck-escalation-email-lib/read-state daemon-dir) (keyword role))
   :sendCalls @send-calls
   :logLines @log-lines
   :escalationRecorded (boolean (get (chase-sweep-lib/read-escalations daemon-dir) (keyword role)))}))
