#!/usr/bin/env bb
;; Test-only harness: one landed-but-open sweep pass against a fixture
;; project root, mirroring handoffd.bb's landed-but-open-sweep!/
;; nudge-qa-landed-but-open! exactly (same chase_sweep_lib.bb functions,
;; same real swarm_handoff.bb send path). Used by
;; specs/pipeline/steps/bl1104LandedButOpenSteps.js.
;;
;; Usage: landed_but_open_sweep_harness.bb <project-root>
(ns landed-but-open-sweep-harness
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

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
  (let [tmp-dir (fs/path project-root ".swarmforge" "landed-but-open-drafts-test")]
    (fs/create-dirs tmp-dir)
    (let [draft (fs/path tmp-dir (str "draft-" (System/nanoTime) ".txt"))]
      (spit (str draft) (str (str/join "\n" lines) "\n"))
      draft)))

;; SWARMFORGE_SKIP_SYNC_INJECT=1: fixture has no live tmux — same posture as
;; dispatch_gap_sweep_harness.bb / dropped_parcel_sweep_harness.bb.
(defn nudge! [item]
  (let [draft (write-scratch-draft! (chase-sweep-lib/landed-but-open-draft-lines item))
        env (merge (into {} (System/getenv))
                   {"SWARMFORGE_ROLE" "coordinator"
                    "SWARMFORGE_SKIP_SYNC_INJECT" "1"})
        result (process/sh ["bb" swarm-handoff-script (str draft)] {:dir project-root :env env})]
    (println "NUDGED" (:id item) (:approval-commit item) "exit=" (:exit result))))

(defn -main []
  (let [roles (load-roles)
        git-ref (chase-sweep-lib/resolve-landed-main-ref project-root)
        commits (chase-sweep-lib/read-ref-subject-commits project-root git-ref)
        items (chase-sweep-lib/landed-but-open-items
               (str (fs/path project-root "backlog" "active"))
               commits
               (scan-dirs roles))]
    (println "BOUNDARY" (chase-sweep-lib/landed-but-open-boundary-detail items))
    (doseq [item items] (nudge! item))
    (println "FLAGGED:" (pr-str (mapv (fn [i] [(:id i) (:approval-commit i)]) items)))))

(-main)
