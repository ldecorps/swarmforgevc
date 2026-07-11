#!/usr/bin/env bb
;; Test-only harness for briefing_email_lib.bb's send-unsent-briefings! -
;; drives the real library against a real fixture directory with a fake
;; send-email! adapter (no real network) and prints a JSON result for
;; acceptance step handlers to assert against.
;;
;; Usage: briefing_email_harness.bb <briefings-dir> <mode>
;;   mode: "success" | "missing-api-key" | "disabled"
;;         | "diagram-available" | "diagram-unavailable" (BL-260)

(ns briefing-email-harness
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "briefing_email_lib.bb")))

(def briefings-dir (nth *command-line-args* 0))
(def mode (nth *command-line-args* 1))

(def emails-sent (atom 0))
(def logs (atom []))
(def last-sent-text (atom nil))
(def last-sent-html (atom :unset))

;; BL-260: the diagram modes exercise send-unsent-briefings!'s :diagram-section
;; adapter path (a 3-arg :send-email! call) through the real
;; build-diagram-section - "diagram-available" fakes one rendered diagram
;; (never a real render-binary invocation, per the testable-module
;; constraint), "diagram-unavailable" mirrors what the render CLI reports
;; when the renderer is missing (nil).
(def diagram-section-adapter
  (case mode
    "diagram-available"
    (fn [] (briefing-email-lib/build-diagram-section [{:name "architecture" :base64 "ZmFrZS1wbmctYnl0ZXM="}]))

    "diagram-unavailable"
    (fn [] (briefing-email-lib/build-diagram-section nil))

    nil))

(def send-email!
  (case mode
    "success" (fn [_subject text] (swap! emails-sent inc) (reset! last-sent-text text) {:success true})
    "missing-api-key" (fn [_s _t] {:success false :reason :missing-api-key :error "email not configured (missing RESEND_API_KEY)"})
    "disabled" (fn [_s _t] {:success false :reason :disabled :error "email not configured (notify_email_to unset)"})
    ("diagram-available" "diagram-unavailable")
    (fn [_subject text html]
      (swap! emails-sent inc)
      (reset! last-sent-text text)
      (reset! last-sent-html html)
      {:success true})))

(def base-adapters
  {:read-briefing-content (fn [f] (slurp (str (fs/path briefings-dir f))))
   :send-email! send-email!
   :log! (fn [& parts] (swap! logs conj (vec parts)))})

(def sent (briefing-email-lib/send-unsent-briefings!
           briefings-dir
           (cond-> base-adapters
             diagram-section-adapter (assoc :diagram-section diagram-section-adapter))))

(println (json/generate-string {:sent sent
                                 :emailsSent @emails-sent
                                 :logs @logs
                                 :lastSentText @last-sent-text
                                 :lastSentHtml (when-not (= :unset @last-sent-html) @last-sent-html)}))
