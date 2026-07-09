#!/usr/bin/env bb

;; BL-128: the one shell-callable entry point for handoff_lib.bb's shared
;; mailbox-dir resolver. Bash scripts that need a role's physical mailbox
;; path (mailbox_note_to_role.sh, inject_note_to_role.sh,
;; route_backlog_to_coder.sh, sweep_stale_inbox.sh, sweep_all_inbox.sh) shell
;; out to this instead of re-parsing roles.tsv themselves - the "no
;; duplicated path-construction logic" requirement applies across the
;; bash/babashka boundary too, not just within .bb files.
;;
;; Usage: mailbox_dir.bb <project-root> <role> <state>
;;   state: outbox | sent | failed | new | in_process | completed | abandoned
;; Prints the resolved directory path (not guaranteed to exist) and exits 0,
;; or exits 1 with an error on stderr if role/state is unrecognized.

(ns mailbox-dir-cli
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: mailbox_dir.bb <project-root> <role> <state>"))
  (System/exit 1))

(defn -main [& args]
  (when (not= 3 (count args))
    (usage))
  (let [[root role state-str] args
        state (keyword state-str)
        role-info (handoff-lib/load-role-info role root)]
    (when-not role-info
      (binding [*out* *err*]
        (println (str "Unknown role: " role)))
      (System/exit 1))
    (println (str (handoff-lib/mailbox-dir role-info state)))))

(apply -main *command-line-args*)
