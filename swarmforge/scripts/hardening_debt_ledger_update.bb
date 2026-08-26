#!/usr/bin/env bb
;; hardening_debt_ledger_update.bb — the ONE mechanical way to record a
;; deferred hardening gate (BL-942). Called by a hardening pass at the
;; moment it takes the office-hours mutation/CRAP bypass and defers a gate
;; to a quiet host - never anything that decides WHETHER to defer (that
;; stays swarmforge/roles/hardender.prompt's own busy-host judgement, out of
;; this ticket's scope).
;;
;; Usage:
;;   hardening_debt_ledger_update.bb <project-root> --defer <parcel> <gate> <file-set-csv> <reason> <load> [<detected-at>]
;;
;; <detected-at> defaults to today (YYYY-MM-DD) when omitted.

(ns hardening-debt-ledger-update
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "hardening_debt_ledger_lib.bb")))
(require '[hardening-debt-ledger-lib :as hdl])

(defn- usage! []
  (binding [*out* *err*]
    (println "Usage: hardening_debt_ledger_update.bb <project-root> --defer <parcel> <gate> <file-set-csv> <reason> <load> [<detected-at>]"))
  (System/exit 1))

(defn- today [] (str (java.time.LocalDate/now)))

(defn- ledger-path [project-root] (fs/path project-root "backlog" "hardening-debt-ledger.yaml"))

(defn- read-rows [project-root]
  (let [p (ledger-path project-root)]
    (if (fs/exists? p) (hdl/parse-ledger (slurp (str p))) [])))

(defn- write-rows! [project-root rows]
  (fs/create-dirs (fs/parent (ledger-path project-root)))
  (spit (str (ledger-path project-root)) (hdl/render-ledger rows)))

(defn -main [& args]
  (let [[project-root mode & rest-args] args]
    (when (or (nil? project-root) (nil? mode)) (usage!))
    (case mode
      "--defer"
      (let [[parcel gate file-set-csv reason load detected-at] rest-args]
        (when (or (nil? parcel) (nil? gate) (nil? file-set-csv) (nil? reason) (nil? load)) (usage!))
        (let [rows (read-rows project-root)
              file-set (hdl/normalize-file-set (clojure.string/split file-set-csv #","))
              before-count (count rows)
              after (hdl/record-deferral rows {:parcel parcel :gate gate :file-set file-set
                                                :reason reason :load load
                                                :detected-at (or detected-at (today))})]
          (write-rows! project-root after)
          (if (> (count after) before-count)
            (println "recorded" gate "deferral for" parcel)
            (println "already recorded (same gate+file-set) - no duplicate row"))))

      (usage!))))

(apply -main *command-line-args*)
