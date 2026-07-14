#!/usr/bin/env bb
;; Test-only harness: runs one dispatch-gap sweep pass against a fixture
;; project root, mirroring handoffd.bb's dispatch-gap-sweep!/auto-route!
;; exactly (same chase_sweep_lib.bb functions, same real swarm_handoff.bb
;; send path via the vector-form process/sh call) - used by the JS
;; acceptance step handlers (specs/pipeline/steps/dispatchGapSteps.js) so
;; "the sweep runs" exercises the real mechanism, not a re-derived
;; approximation of it. Mirrors chase_sweep_test_runner.bb's role as a
;; companion test harness for chase_sweep_lib.bb.
;;
;; Usage: dispatch_gap_sweep_harness.bb <project-root>
(ns dispatch-gap-sweep-harness
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
  (let [tmp-dir (fs/path project-root ".swarmforge" "dispatch-gap-drafts-test")]
    (fs/create-dirs tmp-dir)
    (let [draft (fs/path tmp-dir (str "draft-" (System/nanoTime) ".txt"))]
      (spit (str draft) (str (str/join "\n" lines) "\n"))
      draft)))

;; SWARMFORGE_SKIP_SYNC_INJECT=1: the harness fixture has no live tmux
;; session, and real delivery (the tmux-dependent half of swarm_handoff.bb)
;; is already covered by that script's own test suite - this harness scopes
;; to what BL-222 adds, same posture as test_dispatch_gap_autoroute.sh.
(defn auto-route! [item]
  (let [draft (write-scratch-draft! (chase-sweep-lib/dispatch-gap-draft-lines item))
        env (merge (into {} (System/getenv)) {"SWARMFORGE_ROLE" "coordinator" "SWARMFORGE_SKIP_SYNC_INJECT" "1"})
        result (process/sh ["bb" swarm-handoff-script (str draft)] {:dir project-root :env env})]
    (println "AUTO-ROUTED" (:id item) "exit=" (:exit result))))

(defn -main []
  (let [roles (load-roles)
        gaps (chase-sweep-lib/dispatch-gap-items (str (fs/path project-root "backlog" "active")) (scan-dirs roles))]
    (doseq [item gaps] (auto-route! item))
    (println "GAPS:" (pr-str (mapv :id gaps)))))

(-main)
