#!/usr/bin/env bb
;; Test-only harness for briefing_generation_schedule_lib.bb's
;; generate-briefing-if-due! - drives the real library against a real
;; fixture briefings-dir with fake :notify!/:log! adapters (no real tmux)
;; and an injected now (no real clock/timer) and prints a JSON result for
;; acceptance step handlers to assert against.
;;
;; Usage: briefing_generation_harness.bb <briefings-dir> <now-iso-instant> <hour> <minute>

(ns briefing-generation-harness
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "briefing_generation_schedule_lib.bb")))

(def briefings-dir (nth *command-line-args* 0))
(def now-ms (.toEpochMilli (java.time.Instant/parse (nth *command-line-args* 1))))
(def hour (Integer/parseInt (nth *command-line-args* 2)))
(def minute (Integer/parseInt (nth *command-line-args* 3)))

(def notified (atom []))
(def logs (atom []))

(def fired?
  (briefing-generation-schedule-lib/generate-briefing-if-due!
   now-ms hour minute briefings-dir
   {:notify! (fn [text] (swap! notified conj text))
    :log! (fn [& parts] (swap! logs conj (vec parts)))}))

(println (json/generate-string {:fired fired? :notified @notified :logs @logs}))
