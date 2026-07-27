#!/usr/bin/env bb
;; BL-655: the human-only CLI for engaging/releasing/inspecting ambulance
;; mode. Ambulance is entered and left by a human only - nothing in the
;; swarm ever engages one for itself (mirrors expedite_cli.bb/
;; pipeline_stage_cli.bb's own <project-root> <verb> shape).
;;
;; Usage:
;;   ambulance_cli.bb <project-root> engage <BL-id>
;;     Writes the marker naming <BL-id> as the sole ambulance patient.
;;     Refuses (exit 1) a syntactically invalid id or one with no YAML file
;;     anywhere under backlog/ - engaging a ticket that does not exist would
;;     hold EVERYTHING forever, the deadlock the operator ruled out.
;;   ambulance_cli.bb <project-root> release
;;     Clears the marker. A no-op (exit 0) if nothing is engaged.
;;   ambulance_cli.bb <project-root> status
;;     Prints the current status as JSON - {"active":true,"ticket":...,
;;     "engagedAtMs":...,"by":...} when engaged, {"active":false,"reason":...}
;;     otherwise. Read-only, never writes the marker.
;; Every subcommand prints one JSON object and exits 0 on success.

(ns ambulance-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "ambulance_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: ambulance_cli.bb <project-root> engage <BL-id>|release|status"))
  (System/exit 1))

(defn- refuse! [msg]
  (binding [*out* *err*]
    (println (str "ambulance_cli.bb: " msg)))
  (System/exit 1))

(defn- engage-cmd! [root ticket]
  (cond
    (nil? ticket)
    (usage)

    (not (re-matches ambulance-lib/ticket-id-pattern ticket))
    (refuse! (str "\"" ticket "\" is not a valid BL-### ticket id"))

    (not (ambulance-lib/ticket-has-file? root ticket))
    (refuse! (str "refusing to engage " ticket
                  " - no YAML file for it anywhere under backlog/ (would hold everything forever)"))

    :else
    (println (json/generate-string (ambulance-lib/engage! root ticket "cli")))))

(defn -main [& args]
  (let [[project-root subcommand ticket] args]
    (when (or (nil? project-root) (nil? subcommand)) (usage))
    (let [root (str (fs/canonicalize project-root))]
      (case subcommand
        "engage" (engage-cmd! root ticket)
        "release" (println (json/generate-string (ambulance-lib/release! root)))
        "status" (println (json/generate-string (ambulance-lib/describe-status root)))
        (usage)))))

(apply -main *command-line-args*)
