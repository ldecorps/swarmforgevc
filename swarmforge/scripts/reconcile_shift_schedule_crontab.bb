#!/usr/bin/env bb
;; BL-1162: reconcile legacy operator schedule lines into an existing crontab.
;; Swarm-shift conf rendering (BL-660) is out of scope until that ticket lands.

(ns reconcile-shift-schedule-crontab
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "legacy_operator_schedule_lib.bb")))

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

(defn legacy-reconcile [existing-lines schedule]
  (let [desired (legacy-operator-schedule-lib/render-legacy-lines schedule)
        new-lines (vec (concat existing-lines desired))]
    {:lines new-lines
     :changed? (not= (vec existing-lines) new-lines)
     :scheduling? true
     :mode :legacy}))

(defn reconcile
  [root existing-lines]
  (let [stripped (strip-schedule-lines existing-lines root)]
    (if-let [legacy (legacy-operator-schedule-lib/resolve-legacy-schedule root)]
      (legacy-reconcile stripped legacy)
      {:lines stripped
       :changed? (not= (vec existing-lines) stripped)
       :scheduling? false
       :mode :none})))

(defn -main []
  (let [root (first *command-line-args*)
        existing (str/split-lines (or (System/getenv "CRONTAB_LINES") ""))
        result (reconcile root existing)]
    (println (json/generate-string result))))

(when (= *file* (System/getProperty "babashka.file"))
  (-main))
