#!/usr/bin/env bb
;; BL-660: apply shift schedule to a fixture/user crontab from swarmforge.conf.

(ns apply-shift-schedule
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "swarm_shift_lib.bb")))
(load-file (str (fs/path script-dir "shift_schedule_applier_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: apply_shift_schedule.bb <project-root> [--crontab-file PATH] [--dry-run]"))
  (System/exit 1))

(defn conf-path [root]
  (fs/path root "swarmforge" "swarmforge.conf"))

(defn read-conf [root]
  (if (fs/exists? (conf-path root))
    (slurp (str (conf-path root)))
    ""))

(defn -main []
  (let [args (vec *command-line-args*)
        root (or (first args) (usage))
        rest-args (drop 1 args)
        crontab-file (or (some (fn [[k v]] (when (= k "--crontab-file") v))
                               (partition 2 rest-args))
                         (str (fs/path root ".swarmforge" "operator" "shift-crontab.fixture")))
        dry-run? (some #{"--dry-run"} rest-args)
        conf (read-conf root)
        schedule (swarm-shift-lib/resolve-schedule conf)
        existing (if (fs/exists? crontab-file)
                   (str/split-lines (slurp crontab-file))
                   [])
        start-script (str root "/start-swarm.sh")
        stop-script (str root "/stop-swarm.sh")]
    (if schedule
      (let [{:keys [lines changed? surfaced-human]}
            (shift-schedule-applier-lib/reconcile-crontab
             existing
             {:root root
              :start-local (:start-local schedule)
              :stop-local (:stop-local schedule)
              :start-script start-script
              :stop-script stop-script})]
        (when (and changed? (not dry-run?))
          (fs/create-dirs (fs/parent crontab-file))
          (spit crontab-file (str (str/join "\n" lines) "\n")))
        (println (json/generate-string
                  {:applied (boolean schedule)
                   :changed changed?
                   :start (:start-local schedule)
                   :stop (:stop-local schedule)
                   :surfaced-human surfaced-human})))
      (println (json/generate-string {:applied false :changed false})))))

(when (= *file* (System/getProperty "babashka.file"))
  (-main))
