#!/usr/bin/env bb
;; BL-1162: legacy operator schedule from continuous-shifts.json when swarm_shift
;; is absent. Pure — no crontab I/O.

(ns legacy-operator-schedule-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def operator-marker-prefix "# swarmforge-operator-schedule root=[")

(defn- parse-window [s]
  (when-let [[_ start stop] (re-matches #"^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\b" (str/trim (or s "")))]
    [(mapv #(Integer/parseInt %) (str/split start #":"))
     (mapv #(Integer/parseInt %) (str/split stop #":"))]))

(defn- cron-field [[hour minute]]
  (str (int minute) " " (int hour)))

(defn- schedule-marker [root]
  (str operator-marker-prefix root "]"))

(defn render-legacy-lines
  [{:keys [root start-local stop-local start-script stop-script]}]
  [(str (cron-field start-local) " * * * " start-script " " (schedule-marker root) " kind=start")
   (str (cron-field stop-local) " * * * " stop-script " " (schedule-marker root) " kind=stop")])

(defn- legacy-mode-map
  [root mode window]
  (let [operator (str (fs/path root ".swarmforge" "operator"))
        [[sh sm] [eh em]] (or (parse-window window) [[9 0] [17 0]])]
    (case mode
      "day-only"
      {:root root
       :start-local [sh sm]
       :stop-local [eh em]
       :start-script (str operator "/day-shift-start.sh")
       :stop-script (str operator "/day-shift-bedtime.sh")}

      ("continuous-3-shift" "night-standing" "continuous")
      {:root root
       :start-local [17 0]
       :stop-local [9 0]
       :start-script (str operator "/night-start.sh")
       :stop-script (str operator "/night-stop.sh")}

      nil)))

(defn resolve-legacy-schedule
  "Returns schedule map or nil when no legacy operator scheduling applies."
  [root]
  (let [path (fs/path root ".swarmforge" "operator" "continuous-shifts.json")]
    (when (fs/exists? path)
      (let [data (json/parse-string (slurp (str path)) true)
            mode (some-> (:mode data) str/trim not-empty)]
        (when mode
          (legacy-mode-map root mode (:window data)))))))

(defn scheduling-enabled?
  [root conf-text]
  (boolean
   (or (some->> (str/split-lines (or conf-text ""))
                 (filter #(str/starts-with? % "config swarm_shift "))
                 first
                 (re-find #"^config\s+swarm_shift\s+(\S+)")
                 second
                 not-empty)
       (resolve-legacy-schedule root))))
