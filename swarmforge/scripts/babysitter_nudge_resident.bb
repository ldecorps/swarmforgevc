#!/usr/bin/env bb
;; Verified resident-pane nudge for the Babysitter hawk.
;;
;; Reuses agent_runtime_inject/notify-agent! (:text) — never raw send-keys.
;;
;; Usage:
;;   bb babysitter_nudge_resident.bb <project-root> <role> <message...>
;;
;; Exit 0 for NUDGED, SKIP_BUSY, or NO_NUDGE; exit 1 on FAILED.

(ns babysitter-nudge-resident
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir "babysitter_nudge_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: babysitter_nudge_resident.bb <project-root> <role> <message...>"))
  (System/exit 1))

(def args (vec *command-line-args*))
(def project-root (nth args 0 nil))
(def role (nth args 1 nil))
(def message (when (> (count args) 2) (str/join " " (drop 2 args))))

(when (or (str/blank? project-root) (str/blank? role) (str/blank? message))
  (usage))

(defn -main []
  (let [result (babysitter-nudge-lib/nudge-resident! project-root role message)]
    (println (babysitter-nudge-lib/format-cli-line result))
    (when (= :failed (:status result))
      (System/exit 1))))

(-main)
