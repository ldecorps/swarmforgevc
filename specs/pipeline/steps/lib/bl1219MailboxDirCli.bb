#!/usr/bin/env bb
;; BL-1219 acceptance driver: resolves a role's REAL mailbox via
;; handoff-lib/mailbox-dir - the exact function the Babashka daemon (and
;; every delivery path, handoff_inject_lib.bb's target-path included) goes
;; through. Used to prove the TypeScript-side mailboxDir/buildRoleInboxes
;; agree with what delivery itself actually resolves to, and to seed
;; acceptance fixtures at the SAME real path production would deliver to.
;;
;; Usage: bb bl1219MailboxDirCli.bb <repo-root> <role>[,<role>...]
;; Prints one JSON line per role:
;; {"role":"coordinator","new":"...","inProcess":"..."}
(require '[babashka.fs :as fs]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." ".." "swarmforge" "scripts" "handoff_lib.bb")))

(def root (first *command-line-args*))
(def roles (some-> (second *command-line-args*) (str/split #",")))
(when (or (not root) (not roles))
  (binding [*out* *err*] (println "usage: bl1219MailboxDirCli.bb <repo-root> <role>[,<role>...]"))
  (System/exit 2))

(def results
  (for [role roles]
    (let [role-info (handoff-lib/load-role-info role root)]
      (when-not role-info
        (binding [*out* *err*] (println "no roles.tsv row for role" role)))
      {:role role
       :new (str (handoff-lib/mailbox-dir role-info :new))
       :inProcess (str (handoff-lib/mailbox-dir role-info :in_process))})))

(doseq [r results]
  (println (json/generate-string r)))
