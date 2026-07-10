#!/usr/bin/env bb
;; Test-only harness for briefing_email_lib.bb's send-unsent-briefings! -
;; drives the real library against a real fixture directory with a fake
;; send-email! adapter (no real network) and prints a JSON result for
;; acceptance step handlers to assert against.
;;
;; Usage: briefing_email_harness.bb <briefings-dir> <mode>
;;   mode: "success" | "missing-api-key" | "disabled"

(ns briefing-email-harness
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "briefing_email_lib.bb")))

(def briefings-dir (nth *command-line-args* 0))
(def mode (nth *command-line-args* 1))

(def emails-sent (atom 0))
(def logs (atom []))

(def send-email!
  (case mode
    "success" (fn [_subject _text] (swap! emails-sent inc) {:success true})
    "missing-api-key" (fn [_s _t] {:success false :reason :missing-api-key :error "email not configured (missing RESEND_API_KEY)"})
    "disabled" (fn [_s _t] {:success false :reason :disabled :error "email not configured (notify_email_to unset)"})))

(def sent (briefing-email-lib/send-unsent-briefings!
           briefings-dir
           {:read-briefing-content (fn [f] (slurp (str (fs/path briefings-dir f))))
            :send-email! send-email!
            :log! (fn [& parts] (swap! logs conj (vec parts)))}))

(println (json/generate-string {:sent sent :emailsSent @emails-sent :logs @logs}))
