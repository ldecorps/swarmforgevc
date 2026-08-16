#!/usr/bin/env bb
;; Test-only harness for briefing_email_lib.bb's send-unsent-briefings! -
;; drives the real library against a real fixture directory with a fake
;; send-email! adapter (no real network) and prints a JSON result for
;; acceptance step handlers to assert against.
;;
;; Usage: briefing_email_harness.bb <briefings-dir> <mode> [arch-outcome] [burn-outcome]
;;   mode: "success" | "missing-api-key" | "disabled"
;;         | "diagram-available" | "diagram-unavailable" (BL-260)
;;         | "diagram-sources-independence" (BL-896: arch-outcome/burn-outcome
;;           each one of "succeeds" | "fails" | "throws")

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
(def last-sent-attachments (atom :unset))

;; BL-260: the diagram modes exercise send-unsent-briefings!'s :diagram-section
;; adapter path through the real build-diagram-section - "diagram-available"
;; fakes two rendered diagrams (never a real render-binary invocation, per
;; the testable-module constraint), "diagram-unavailable" mirrors what the
;; render CLI reports when the renderer is missing (nil).
;;
;; BL-286: "diagram-available" now also exercises the 4-arg (+attachments)
;; :send-email! call - two diagrams (not one) so acceptance can assert the
;; cid<->attachment correspondence is per-diagram, not just present.
(def diagram-section-adapter
  (case mode
    "diagram-available"
    (fn [] (briefing-email-lib/build-diagram-section
            [{:name "architecture" :base64 "ZmFrZS1wbmctYnl0ZXM="}
             {:name "swarm-flow" :base64 "ZmFrZS1zd2FybS1mbG93"}]))

    "diagram-unavailable"
    (fn [] (briefing-email-lib/build-diagram-section nil))

    ;; BL-896 F4/scenario-03/04: drives the real diagram-section-from-sources
    ;; (not just build-diagram-section) with independently-controllable
    ;; architecture/burndown outcomes, so acceptance can assert one source's
    ;; failure never suppresses a succeeding sibling's chart or the send.
    "diagram-sources-independence"
    (let [outcome->thunk
          (fn [outcome items]
            (case outcome
              "throws" (fn [] (throw (ex-info "simulated source failure" {})))
              "fails" (fn [] nil)
              "succeeds" (fn [] items)))
          arch-outcome (nth *command-line-args* 2)
          burn-outcome (nth *command-line-args* 3)]
      (fn [] (briefing-email-lib/diagram-section-from-sources
              (outcome->thunk arch-outcome [{:name "architecture" :base64 "ZmFrZS1wbmctYnl0ZXM="}])
              (outcome->thunk burn-outcome [{:name "not-done-burndown" :base64 "ZmFrZS1idXJuZG93bg=="}]))))

    nil))

;; BL-393: :send-email! is now always called with html (a 3rd arg, minimum -
;; see briefing_email_lib.bb's send-unsent-briefings!), so every mode below
;; accepts and captures it, not only the diagram-specific ones.
(def send-email!
  (case mode
    ("success" "diagram-available" "diagram-unavailable" "diagram-sources-independence")
    (fn [_subject text html & [attachments]]
      (swap! emails-sent inc)
      (reset! last-sent-text text)
      (reset! last-sent-html html)
      (reset! last-sent-attachments attachments)
      {:success true})

    "missing-api-key" (fn [_s _t & _] {:success false :reason :missing-api-key :error "email not configured (missing RESEND_API_KEY)"})
    "disabled" (fn [_s _t & _] {:success false :reason :disabled :error "email not configured (notify_email_to unset)"})))

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
                                 :lastSentHtml (when-not (= :unset @last-sent-html) @last-sent-html)
                                 :lastSentAttachments (when-not (= :unset @last-sent-attachments) @last-sent-attachments)}))
