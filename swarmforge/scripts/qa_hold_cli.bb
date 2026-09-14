#!/usr/bin/env bb
;; qa_hold_cli.bb — BL-1566: the three-verb CLI over the Article 4.2 hold
;; store. Thin IO wrapper over qa_hold_lib.bb — never a second decision
;; about what releases a hold (same "cli wraps the pure lib" convention
;; standing_red_register_cli.bb and ambulance_cli.bb already use).
;;
;; Usage:
;;   qa_hold_cli.bb <project-root> open --task T --commit C --red R[,R...] --evidence E
;;     Writes .swarmforge/qa-holds/<T>.json naming the parcel commit, the
;;     evidence sha, and the red(s) withheld — a comma-separated --red
;;     value is split; the flag may also be repeated.
;;   qa_hold_cli.bb <project-root> status
;;     Prints qa-hold-lib/status-lines for every open hold, one per line —
;;     read-only, never writes a hold.
;;   qa_hold_cli.bb <project-root> close --task T --outcome approved|bounced|abandoned
;;     Moves the record to .swarmforge/qa-holds/closed/<T>.json with the
;;     outcome and a closed-at timestamp — the ONLY exit from the open
;;     store; nothing else here ever deletes a hold record.
;;
;; The store is the PROJECT root's .swarmforge/ (qa_hold_lib.bb's
;; holds-dir), never a worktree-local one — the same root the deprecator
;; adjudications use — so the record stays visible from the master
;; checkout regardless of which worktree opened or closed it.

(ns qa-hold-cli
  (:require [babashka.fs :as fs]
            [clojure.string :as str]
            [cheshire.core :as json]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "qa_hold_lib.bb")))

(defn- usage! []
  (binding [*out* *err*]
    (println "Usage: qa_hold_cli.bb <project-root> open --task T --commit C --red R[,R...] --evidence E")
    (println "       qa_hold_cli.bb <project-root> status")
    (println "       qa_hold_cli.bb <project-root> close --task T --outcome approved|bounced|abandoned"))
  (System/exit 1))

(defn- refuse! [msg]
  (binding [*out* *err*]
    (println (str "qa_hold_cli.bb: " msg)))
  (System/exit 1))

(defn- parse-flags
  "argv (after the subcommand) -> {flag-name value}. --red may repeat; its
   values accumulate (space-joined with a comma so a later comma-split
   sees every one)."
  [args]
  (loop [args args m {}]
    (if (empty? args)
      m
      (let [[flag value & more] args]
        (when-not (and flag (str/starts-with? flag "--") value)
          (usage!))
        (let [k (subs flag 2)]
          (recur more
                 (if (contains? m k)
                   (update m k #(str % "," value))
                   (assoc m k value))))))))

(defn- write-hold! [f m]
  (fs/create-dirs (fs/parent f))
  (spit (str f) (json/generate-string m {:pretty true})))

(defn- cmd-open! [root flags]
  (let [task (get flags "task")
        commit (get flags "commit")
        reds (some->> (get flags "red")
                       (#(str/split % #","))
                       (map str/trim)
                       (remove str/blank?)
                       vec)
        evidence (get flags "evidence")]
    (when-not (and task commit (seq reds))
      (usage!))
    (write-hold! (qa-hold-lib/hold-file root task)
                 {:task task :commit commit :reds reds :evidence evidence})
    (println (str "OPENED " task " " commit))))

(defn- cmd-status! [root]
  (let [holds (qa-hold-lib/read-holds root)
        register-rows (qa-hold-lib/register-rows-for root)
        open-ids (qa-hold-lib/open-ticket-ids-for root)]
    (doseq [line (qa-hold-lib/status-lines holds register-rows open-ids)]
      (println line))))

(defn- cmd-close! [root flags]
  (let [task (get flags "task")
        outcome (get flags "outcome")
        f (qa-hold-lib/hold-file root task)]
    (when-not (and task outcome) (usage!))
    (when-not (fs/exists? f) (refuse! (str "no open hold for task " task)))
    (let [hold (json/parse-string (slurp (str f)) true)
          target (qa-hold-lib/closed-hold-file root task)]
      (write-hold! target (assoc hold :outcome outcome
                                  :closed-at (str (java.time.Instant/now))))
      (fs/delete f))
    (println (str "CLOSED " task " " outcome))))

(defn -main [& args]
  (let [[root cmd & rest-args] args]
    (when (or (nil? root) (nil? cmd)) (usage!))
    (case cmd
      "open" (cmd-open! root (parse-flags rest-args))
      "status" (cmd-status! root)
      "close" (cmd-close! root (parse-flags rest-args))
      (usage!))))

(apply -main *command-line-args*)
