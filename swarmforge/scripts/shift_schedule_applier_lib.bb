#!/usr/bin/env bb
;; BL-660: crontab render/diff for shift schedule applier — pure, no shell.

(ns shift-schedule-applier-lib
  ;; BL-1381: babashka.process belongs HERE, not inside a function body.
  ;; SCI resolves an alias at ANALYSIS time, so a runtime `(require '[...])`
  ;; inside budgetShiftGovernorVerdict left `process/shell` unresolvable and
  ;; the whole FILE failed to load - taking down every consumer at load rather
  ;; than at the governor call. The schedule cron install was therefore inert
  ;; on every ./swarm start from 2026-08-27, and this lib's own BL-660 runner
  ;; was red the entire time.
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def begin-marker "# swarmforge-shift-schedule-begin")
(def end-marker "# swarmforge-shift-schedule-end")

(defn- cron-field [[hour minute]]
  (str (int minute) " " (int hour)))

(defn render-lines
  [{:keys [root start-local stop-local start-script stop-script]}]
  [(str begin-marker " " root)
   (str (cron-field start-local) " * * * " start-script)
   (str (cron-field stop-local) " * * * " stop-script)
   (str end-marker " " root)])

(defn split-managed
  [lines root]
  (let [begin (str begin-marker " " root)
        end (str end-marker " " root)
        indexed (map-indexed vector lines)
        begin-idx (some (fn [[i l]] (when (= (str/trim l) begin) i)) indexed)
        end-idx (some (fn [[i l]] (when (= (str/trim l) end) i)) indexed)]
    (if (and begin-idx end-idx (< begin-idx end-idx))
      {:before (subvec (vec lines) 0 begin-idx)
       :managed (subvec (vec lines) (inc begin-idx) end-idx)
       :after (subvec (vec lines) (inc end-idx))
       :had-block? true}
      {:before (vec lines) :managed [] :after [] :had-block? false})))

(defn- parse-hhmm [s]
  (let [[h m] (str/split (str s) (re-pattern ":"))]
    [(Integer/parseInt h) (Integer/parseInt m)]))

(defn- time-vec [t]
  (if (vector? t) t (parse-hhmm t)))

(defn reconcile-crontab
  "Idempotent apply: returns {:lines :changed? :surfaced-human [lines]}."
  [existing-lines {:keys [root start-local stop-local start-script stop-script]}]
  (let [split (split-managed existing-lines root)
        desired (render-lines {:root root :start-local (time-vec start-local)
                               :stop-local (time-vec stop-local)
                               :start-script start-script :stop-script stop-script})
        human-only (remove #(str/starts-with? (str/trim %) "# swarmforge-shift-schedule")
                           (concat (:before split) (:after split)))
        new-lines (vec (concat (:before split) desired (:after split)))
        changed? (not= (vec existing-lines) new-lines)]
    {:lines new-lines
     :changed? changed?
     :surfaced-human (vec (filter #(and (not (str/blank? %))
                                        (not (str/starts-with? (str/trim %) "# swarmforge-shift-schedule")))
                                  human-only))}))

(defn stale-shift-lines?
  "True when armed lines do not match the newly resolved shift times."
  [managed-lines start-local stop-local]
  (let [body (remove str/blank? managed-lines)
        want-start (second (render-lines {:root "x"
                                          :start-local (parse-hhmm start-local)
                                          :stop-local (parse-hhmm stop-local)
                                          :start-script "S" :stop-script "T"}))]
    (not= (vec body) (subvec (vec want-start) 1 3))))

;; BL-666: shift boundary hosts budgetShiftGovernorVerdict (compiled CLI).
(defn budgetShiftGovernorVerdict
  [project-root now-ms]
  (let [cli (str project-root "/extension/out/tools/budget-shift-governor.js")]
    (when (fs/exists? cli)
      (try
        ;; The require moved to the ns form (BL-1381). The fs/exists? guard
        ;; above and this try/catch stay: the verdict is best-effort, and a
        ;; governor that cannot run must yield nil rather than break a caller.
        (let [{:keys [exit out]} (process/shell {:dir project-root :out :string :err :string}
                                                (str "node " cli " --now " now-ms))]
          (when (zero? exit)
            (json/parse-string out true)))
        (catch Exception _ nil)))))
