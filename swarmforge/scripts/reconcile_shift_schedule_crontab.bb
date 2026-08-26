#!/usr/bin/env bb
;; BL-1162: reconcile legacy operator schedule lines into an existing crontab.
;; BL-660: when config swarm_shift is set, render shift schedule instead of legacy-only.

(ns reconcile-shift-schedule-crontab
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "legacy_operator_schedule_lib.bb")))
(load-file (str (fs/path script-dir "swarm_shift_lib.bb")))
(load-file (str (fs/path script-dir "shift_schedule_applier_lib.bb")))

(defn- strip-schedule-lines [lines root]
  (let [op-marker (str "# swarmforge-operator-schedule root=[" root "]")
        begin (str "# swarmforge-shift-schedule-begin " root)
        end (str "# swarmforge-shift-schedule-end " root)]
    (vec
     (remove
      (fn [line]
        (or (str/includes? line op-marker)
            (str/includes? line begin)
            (str/includes? line end)
            (str/includes? line (str root "/.swarmforge/operator/"))
            (str/includes? line (str root "/start-swarm.sh"))
            (str/includes? line (str root "/stop-swarm.sh"))))
      lines))))

(defn- conf-path [root]
  (fs/path root "swarmforge" "swarmforge.conf"))

(defn- read-conf [root]
  (if (fs/exists? (conf-path root))
    (slurp (str (conf-path root)))
    ""))

(defn- parse-hhmm-vec [s]
  (let [[h m] (str/split (str s) (re-pattern ":"))]
    [(Integer/parseInt h) (Integer/parseInt m)]))

(defn swarm-shift-reconcile [existing-lines root conf-text]
  (when-let [schedule (swarm-shift-lib/resolve-schedule conf-text)]
    (let [{:keys [lines changed?]}
          (shift-schedule-applier-lib/reconcile-crontab
           existing-lines
           {:root root
            :start-local (parse-hhmm-vec (:start-local schedule))
            :stop-local (parse-hhmm-vec (:stop-local schedule))
            :start-script (str root "/start-swarm.sh")
            :stop-script (str root "/stop-swarm.sh")})]
      {:lines lines
       :changed? changed?
       :scheduling? true
       :mode :swarm_shift})))

(defn legacy-reconcile [existing-lines schedule]
  (let [desired (legacy-operator-schedule-lib/render-legacy-lines schedule)
        new-lines (vec (concat existing-lines desired))]
    {:lines new-lines
     :changed? (not= (vec existing-lines) new-lines)
     :scheduling? true
     :mode :legacy}))

(defn reconcile
  [root existing-lines]
  (let [stripped (strip-schedule-lines existing-lines root)
        conf (read-conf root)]
    (or (swarm-shift-reconcile stripped root conf)
        (if-let [legacy (legacy-operator-schedule-lib/resolve-legacy-schedule root)]
          (legacy-reconcile stripped legacy)
          {:lines stripped
           :changed? (not= (vec existing-lines) stripped)
           :scheduling? false
           :mode :none}))))

(defn -main []
  (let [root (first *command-line-args*)
        existing (str/split-lines (or (System/getenv "CRONTAB_LINES") ""))
        result (reconcile root existing)]
    (println (json/generate-string result))))

(when (= *file* (System/getProperty "babashka.file"))
  (-main))
