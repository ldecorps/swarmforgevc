#!/usr/bin/env bb

;; BL-327: the one shell-callable entry point for BL-318's
;; promotion-blocked-by-quiet-period?/format-self-generated-source
;; (operator_lib.bb) - so the coordinator's ONLY way to reach the
;; quiet-period gate is a real command with a defined contract, never
;; prompt prose hand-assembling a bare Clojure call. Never reimplements the
;; decision logic itself - operator_lib.bb stays the single source of
;; truth; this file only parses args, calls it, and reports.
;;
;; Usage:
;;   quiet_period_gate_cli.bb blocked <candidate-yaml-path> --backlog-drained <true|false> --roster-idle <true|false>
;;     stdout "allowed", exit 0 - promotion is not blocked.
;;     stdout "blocked", exit 1 - promotion IS blocked.
;;     stdout "error", stderr a reason, exit 2 - the candidate could not be
;;       read, or a quiet-state flag is missing/invalid. FAILS CLOSED: never
;;       answers "allowed" on error.
;;   quiet_period_gate_cli.bb compose-source <reason...>
;;     stdout the canonical self-generated source line, exit 0.

(ns quiet-period-gate-cli
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "operator_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage:")
    (println "  quiet_period_gate_cli.bb blocked <candidate-yaml-path> --backlog-drained <true|false> --roster-idle <true|false>")
    (println "  quiet_period_gate_cli.bb compose-source <reason...>"))
  (System/exit 2))

(defn- error! [reason]
  (println "error")
  (binding [*out* *err*] (println (str "error: " reason)))
  (System/exit 2))

;; Duplicated from operator_runtime.bb's own private read-yaml-field - the
;; same small live-glue duplication already established across this
;; codebase's independent pure libs/CLIs (ticket_status_lib.bb,
;; chase_sweep_lib.bb) rather than cross-namespace-coupling to any of them.
(defn- read-yaml-field [content field]
  (let [prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (str/trim (subs line (count prefix)))))
          (str/split-lines content))))

(defn- parse-opts [args]
  (into {} (for [[k v] (partition 2 args)]
             [(keyword (str/replace k #"^--" "")) v])))

(defn- parse-required-bool! [opts flag]
  (let [raw (get opts flag)]
    (cond
      (= raw "true") true
      (= raw "false") false
      (nil? raw) (error! (str "missing required --" (name flag) " <true|false>"))
      :else (error! (str "--" (name flag) " must be exactly \"true\" or \"false\", got: " (pr-str raw))))))

(defn- run-blocked! [args]
  (let [[candidate-path & flag-args] args
        opts (parse-opts flag-args)]
    (when (str/blank? candidate-path) (usage))
    (let [content (try (slurp candidate-path) (catch Exception _ nil))]
      (when (nil? content)
        (error! (str "candidate ticket unreadable: " candidate-path)))
      (let [backlog-drained? (parse-required-bool! opts :backlog-drained)
            roster-idle? (parse-required-bool! opts :roster-idle)
            candidate {:source (read-yaml-field content "source")}
            blocked? (operator-lib/promotion-blocked-by-quiet-period?
                      candidate {:backlog-drained? backlog-drained? :roster-idle? roster-idle?})]
        (println (if blocked? "blocked" "allowed"))
        (System/exit (if blocked? 1 0))))))

(defn- run-compose-source! [args]
  (when (empty? args) (usage))
  (println (operator-lib/format-self-generated-source (str/join " " args)))
  (System/exit 0))

(defn -main [& args]
  (let [[subcommand & rest-args] args]
    (case subcommand
      "blocked" (run-blocked! (vec rest-args))
      "compose-source" (run-compose-source! (vec rest-args))
      (usage))))

(apply -main *command-line-args*)
