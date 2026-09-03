#!/usr/bin/env bb
;; babysitter_waive.bb — BL-1344: the ONE mechanical way to record, list or
;; withdraw a babysitter finding waive. A human/coordinator runs this AFTER
;; investigating a finding and concluding it is legitimate or already
;; remediated. The sweep never calls it: a machine may propose, only a
;; recorded decision disposes (BL-848's line, applied here).
;;
;; Usage:
;;   babysitter_waive.bb <project-root> --list
;;   babysitter_waive.bb <project-root> --record <finding-key> <waived-by> <reason> [<waived-at>]
;;   babysitter_waive.bb <project-root> --withdraw <finding-key>
;;
;; <waived-at> defaults to today (YYYY-MM-DD).

(ns babysitter-waive
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "babysitter_waive_lib.bb")))
(require '[babysitter-waive-lib :as w])

(defn- usage! []
  (binding [*out* *err*]
    (println "Usage: babysitter_waive.bb <project-root> --list")
    (println "       babysitter_waive.bb <project-root> --record <finding-key> <waived-by> <reason> [<waived-at>]")
    (println "       babysitter_waive.bb <project-root> --withdraw <finding-key>"))
  (System/exit 2))

(defn- today [] (str (java.time.LocalDate/now)))

(defn- read-or-die [path]
  (let [result (w/read-waive-store path)]
    (when-not (:ok? result)
      (binding [*out* *err*]
        (println (str "babysitter_waive.bb: refusing to touch an unreadable waive store (" (name (:reason result)) "): " path))
        (println "Fix or remove the store by hand - overwriting it here would erase waives nobody can currently read."))
      (System/exit 1))
    (:waives result)))

(defn -main [& args]
  (let [[project-root command & rest-args] args]
    (when (or (str/blank? (str project-root)) (str/blank? (str command))) (usage!))
    (let [path (w/waive-store-path project-root)]
      (case command
        "--list"
        (let [lines (w/format-waive-listing (read-or-die path))]
          (if (seq lines)
            (doseq [line lines] (println line))
            (println "no waived findings")))

        "--record"
        (let [[key waived-by reason waived-at] rest-args]
          (when (some str/blank? [(str key) (str waived-by) (str reason)]) (usage!))
          (let [waives (read-or-die path)
                updated (w/record-waive waives {:key key :waived-by waived-by :reason reason
                                                :waived-at (or waived-at (today))})]
            (fs/create-dirs (fs/parent path))
            (spit path (w/render-waives updated))
            (println (str "waived " key " (by " waived-by ")"))))

        "--withdraw"
        (let [[key] rest-args]
          (when (str/blank? (str key)) (usage!))
          (let [waives (read-or-die path)]
            (if-not (contains? waives key)
              (do (binding [*out* *err*] (println (str "no waive recorded for " key)))
                  (System/exit 1))
              (do (spit path (w/render-waives (dissoc waives key)))
                  (println (str "withdrew the waive for " key))))))

        (usage!)))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
