#!/usr/bin/env bb
;; Test-only harness for briefing_generation_schedule_lib.bb's
;; generate-briefing-if-due! - drives the real library against a real
;; fixture briefings-dir with fake :notify!/:log! adapters (no real tmux)
;; and an injected now (no real clock/timer) and prints a JSON result for
;; acceptance step handlers to assert against.
;;
;; Usage: briefing_generation_harness.bb <briefings-dir> <now-iso-instant> <hour> <minute> [hibernated]
;;   hibernated: "true" | "false" (default "false")
;;
;; BL-308: when hibernated is "true", :compose-headless! is wired to the
;; REAL banked_briefing_lib.bb composer (a fixed, deterministic synthetic
;; signal set - this is a harness, not the real daemon's adapters, which
;; are exercised separately by test_handoffd_banked_briefing_wiring.sh) and
;; the composed file is actually written under briefings-dir, so acceptance
;; steps can read its content back.

(ns briefing-generation-harness
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "briefing_generation_schedule_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "banked_briefing_lib.bb")))

(def briefings-dir (nth *command-line-args* 0))
(def now-ms (.toEpochMilli (java.time.Instant/parse (nth *command-line-args* 1))))
(def hour (Integer/parseInt (nth *command-line-args* 2)))
(def minute (Integer/parseInt (nth *command-line-args* 3)))
(def hibernated? (= "true" (nth *command-line-args* 4 "false")))

(def notified (atom []))
(def logs (atom []))
(def composed-file (atom nil))

(defn compose-headless! [day-key]
  (let [content (banked-briefing-lib/compose-banked-briefing
                 {:day-key day-key
                  :profile-name "concierge-banked"
                  :hibernated-at-ms (.toEpochMilli (java.time.Instant/parse "2026-07-10T06:00:00Z"))
                  :backlog-counts {:active 0 :paused 3 :done 42}
                  :git-activity-lines ["abc1234 Fix thing" "def5678 Add other thing"]
                  :daemon-health-lines ["chases=1 nudges=0 respawns=0 failedDeliveries=0"]})
        file-path (str (fs/path briefings-dir (str day-key ".md")))]
    (spit file-path content)
    (reset! composed-file file-path)))

(def fired?
  (briefing-generation-schedule-lib/generate-briefing-if-due!
   now-ms hour minute briefings-dir hibernated?
   {:notify! (fn [text] (swap! notified conj text))
    :compose-headless! compose-headless!
    :emit-sidecar! (fn [] nil)
    :log! (fn [& parts] (swap! logs conj (vec parts)))}))

(println (json/generate-string
          {:fired fired?
           :notified @notified
           :logs @logs
           :composedFile @composed-file
           :composedContent (when @composed-file (slurp @composed-file))}))
