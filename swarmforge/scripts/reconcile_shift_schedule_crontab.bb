#!/usr/bin/env bb
;; BL-1162: reconcile shift/legacy schedule lines into an existing crontab.

(ns reconcile-shift-schedule-crontab
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "swarm_shift_lib.bb")))
(load-file (str (fs/path script-dir "shift_schedule_applier_lib.bb")))
(load-file (str (fs/path script-dir "legacy_operator_schedule_lib.bb")))

(defn conf-path [root]
  (fs/path root "swarmforge" "swarmforge.conf"))

(defn read-conf [root]
  (if (fs/exists? (conf-path root))
    (slurp (str (conf-path root)))
  ""))

(defn legacy-reconcile [existing-lines schedule]
  (let [desired (legacy-operator-schedule-lib/render-legacy-lines schedule)
        new-lines (vec (concat existing-lines desired))]
    {:lines new-lines
     :changed? (not= (vec existing-lines) new-lines)
     :scheduling? true
     :mode :legacy}))

(defn- strip-schedule-lines [lines root]
  (let [split (shift-schedule-applier-lib/split-managed lines root)
        op-marker (str "# swarmforge-operator-schedule root=[" root "]")]
    (vec (remove #(str/includes? % op-marker)
                 (concat (:before split) (:after split))))))

(defn reconcile
  [root existing-lines]
  (let [stripped (strip-schedule-lines existing-lines root)
        conf (read-conf root)
        swarm (swarm-shift-lib/resolve-schedule conf)]
    (cond
      swarm
      (let [start-script (str root "/start-swarm.sh")
            stop-script (str root "/stop-swarm.sh")
            {:keys [lines changed? surfaced-human]}
            (shift-schedule-applier-lib/reconcile-crontab
             stripped
             (merge swarm
                    {:root root
                     :start-script start-script
                     :stop-script stop-script}))]
        {:lines lines
         :changed? (not= (vec existing-lines) lines)
         :scheduling? true
         :mode :swarm-shift
         :surfaced-human surfaced-human})

      :else
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
