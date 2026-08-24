#!/usr/bin/env bb
;; Test-only harness: one pass of BOTH active-backlog sweeps (dispatch-gap
;; + unassigned-active), mirroring handoffd.bb's same-tick wiring. Used by
;; specs/pipeline/steps/bl1093NobodyAssigneeSteps.js (BL-1093).
;;
;; Usage: nobody_assignee_sweeps_harness.bb <project-root>
(ns nobody-assignee-sweeps-harness
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "task_commit_coherence_gate_lib.bb")))

(def project-root (first *command-line-args*))
(def swarm-handoff-script (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "swarm_handoff.bb")))

(defn load-roles []
  (let [tsv (fs/path project-root ".swarmforge" "roles.tsv")]
    (into {}
          (for [line (str/split-lines (slurp (str tsv)))
                :when (not (str/blank? line))
                :let [[role worktree-name worktree-path session display agent receive-mode] (str/split line #"\t")]]
            [role {:role role :worktree-name worktree-name :worktree-path worktree-path
                   :session session :display display :agent agent :receive-mode (or receive-mode "task")}]))))

(defn scan-dirs [roles]
  (vec (for [[_ role-info] roles
             state [:new :in_process :completed :sent :outbox]]
         (str (handoff-lib/mailbox-dir role-info state)))))

(defn write-scratch-draft! [lines]
  (let [tmp-dir (fs/path project-root ".swarmforge" "nobody-assignee-drafts-test")]
    (fs/create-dirs tmp-dir)
    (let [draft (fs/path tmp-dir (str "draft-" (System/nanoTime) ".txt"))]
      (spit (str draft) (str (str/join "\n" lines) "\n"))
      draft)))

(defn head-commit-10 []
  (let [result (process/sh ["git" "-C" project-root "rev-parse" "--short=10" "HEAD"])]
    (when (zero? (:exit result))
      (str/trim (:out result)))))

(defn auto-route! [item]
  (let [commit (or (head-commit-10) "")
        lines (chase-sweep-lib/dispatch-gap-draft-lines item commit)]
    (when lines
      (let [draft (write-scratch-draft! lines)
            env (merge (into {} (System/getenv))
                       {"SWARMFORGE_ROLE" "coordinator"
                        "SWARMFORGE_SKIP_SYNC_INJECT" "1"
                        task-commit-coherence-gate-lib/dispatch-gap-autoroute-env "1"})
            result (process/sh ["bb" swarm-handoff-script (str draft)] {:dir project-root :env env})]
        (println "AUTO-ROUTED" (:id item) "exit=" (:exit result)
                 (when-not (zero? (:exit result))
                   (task-commit-coherence-gate-lib/operator-refusal-log-line (:err result))))))))

(defn nudge-unassigned! [item]
  (let [draft (write-scratch-draft! (chase-sweep-lib/unassigned-active-draft-lines item))
        env (merge (into {} (System/getenv))
                   {"SWARMFORGE_ROLE" "coordinator"
                    "SWARMFORGE_SKIP_SYNC_INJECT" "1"})
        result (process/sh ["bb" swarm-handoff-script (str draft)] {:dir project-root :env env})]
    (println "UNASSIGNED-NUDGED" (:id item) "exit=" (:exit result))))

(defn -main []
  (let [roles (load-roles)
        active (str (fs/path project-root "backlog" "active"))
        dirs (scan-dirs roles)
        gaps (chase-sweep-lib/dispatch-gap-items active dirs)
        unassigned (chase-sweep-lib/unassigned-active-items active dirs)]
    (doseq [item gaps] (auto-route! item))
    (doseq [item unassigned] (nudge-unassigned! item))
    (println "GAPS:" (pr-str (mapv :id gaps)))
    (println "UNASSIGNED:" (pr-str (mapv :id unassigned)))))

(-main)
