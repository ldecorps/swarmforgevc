#!/usr/bin/env bb
;; BL-392: test-only harness for briefing_email_lib.bb's pure
;; build-briefing-subject - no filesystem fixture needed (the function
;; takes date-label/content directly), so this just wires the raw args
;; through and prints the result as JSON for acceptance step handlers.
;;
;; Usage: briefing_subject_harness.bb <date-label> <content>

(ns briefing-subject-harness
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "briefing_email_lib.bb")))

(def date-label (nth *command-line-args* 0))
(def content (nth *command-line-args* 1))

(println (json/generate-string {:subject (briefing-email-lib/build-briefing-subject date-label content)}))
