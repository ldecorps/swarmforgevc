#!/usr/bin/env bb
;; BL-619: test harness driving the REAL briefing_email_lib.bb composition
;; with a :token-burn-section adapter that shells to the REAL compiled
;; token-burn-section.js CLI against a REAL fixture project root - the
;; acceptance-level proof that "the briefing email is composed" actually
;; produces a leading warning / an appended one-liner / an unaffected send
;; when the section command fails.
;;
;; Deliberately does NOT load-file handoffd.bb: that file's own bottom-of-
;; file main is gated on *command-line-args*, and THIS script receives its
;; own positional args - load-file'ing handoffd.bb here would see this
;; script's args and risk launching a real daemon loop. Same posture as
;; briefing_email_harness.bb (BL-214), which shells to compiled CLIs
;; directly rather than reusing handoffd.bb's own adapter wrappers.
;;
;; Usage: bl619_token_burn_briefing_harness.bb <project-root> <briefings-dir> <mode> [now-ms]
;;   mode: "success" | "section-command-fails"
;;   now-ms: injected clock passed to token-burn-section.js's --now (ignored
;;           for "section-command-fails", where the CLI is never invoked)

(ns bl619-token-burn-briefing-harness
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "briefing_email_lib.bb")))

(def project-root (nth *command-line-args* 0))
(def briefings-dir (nth *command-line-args* 1))
(def mode (nth *command-line-args* 2))
(def now-ms (nth *command-line-args* 3 nil))

(defn token-burn-section []
  (when (= mode "success")
    (let [cli-path (str (fs/path project-root "extension" "out" "tools" "token-burn-section.js"))
          args (cond-> ["node" cli-path]
                 now-ms (into ["--now" now-ms]))
          {:keys [exit out]} (process/sh args {:dir project-root})]
      (when (zero? exit)
        (let [{:keys [leadingText appendedText subjectMarker]} (json/parse-string out true)]
          {:leading-text leadingText :appended-text appendedText :subject-marker? subjectMarker})))))

(def sent-subjects (atom []))
(def sent-texts (atom []))
(def emails-sent (atom 0))

(def sent
  (briefing-email-lib/send-unsent-briefings!
   briefings-dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path briefings-dir f))))
    :send-email! (fn [subject text & _]
                   (swap! emails-sent inc)
                   (swap! sent-subjects conj subject)
                   (swap! sent-texts conj text)
                   {:success true})
    :token-burn-section token-burn-section
    :log! (fn [& _] nil)}))

(println (json/generate-string {:sent sent
                                 :emailsSent @emails-sent
                                 :subject (first @sent-subjects)
                                 :text (first @sent-texts)}))
