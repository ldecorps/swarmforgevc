#!/usr/bin/env bb
;; BL-106: validates every role worktree's branch against the unified
;; <swarm_name>/<role> namespace (branch_naming_lib.bb). Prints one
;; MISMATCH line per offending role naming the expected branch and exits 1
;; if any are found (branch-ns-03); prints OK and exits 0 otherwise.
;;
;; NOT wired into swarmforge.sh's automatic startup path yet: enabling this
;; as a hard launch gate must happen ALONGSIDE running
;; migrate_branch_names.sh on a given swarm's repo, never before it - a
;; swarm still on the pre-BL-106 mixed branch scheme (swarmforge-<role> /
;; swarm/<role>) would otherwise fail every future launch/ensure/restart
;; before it ever gets the chance to migrate. Run this manually to check a
;; swarm's current state, or after a migration to confirm it landed clean.
;;
;; Usage: check_branch_namespace.bb <project-root>

(ns check-branch-namespace
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "branch_naming_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "swarm_identity_lib.bb")))

(defn usage []
  (binding [*out* *err*] (println "Usage: check_branch_namespace.bb <project-root>"))
  (System/exit 1))

(def project-root (or (first *command-line-args*) (usage)))
(def swarm-name (swarm-identity-lib/own-swarm-name project-root))

(defn current-branch [worktree-path]
  (str/trim (:out (process/sh "git" "-C" worktree-path "rev-parse" "--abbrev-ref" "HEAD"))))

(defn parse-roles-tsv-line [line]
  (let [[role worktree-name worktree-path] (str/split line #"\t")]
    {:role role :worktree-name worktree-name :worktree-path worktree-path}))

(defn -main []
  (let [roles-file (fs/path project-root ".swarmforge" "roles.tsv")
        entries (->> (slurp (str roles-file))
                     str/split-lines
                     (remove str/blank?)
                     (map parse-roles-tsv-line)
                     (remove #(= (:worktree-name %) "master")))
        mismatches
        (for [{:keys [role worktree-path]} entries
              :let [actual (current-branch worktree-path)
                    result (branch-naming-lib/validate-branch actual swarm-name role)]
              :when (not (:ok result))]
          (str "MISMATCH: role " role " is on branch \"" actual "\", expected \"" (:expected result) "\""))]
    (if (seq mismatches)
      (do
        (doseq [m mismatches] (println m))
        (System/exit 1))
      (println (str "OK: every role worktree branch matches the " swarm-name "/<role> namespace")))))

(-main)
