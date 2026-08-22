#!/usr/bin/env bb
;; Test-only harness: runs one batch-claim-progress sweep pass against a
;; fixture project root, mirroring handoffd.bb's batch-claim-progress-
;; sweep!/nudge-coordinator-batch-claim-suspect! exactly (same chase_sweep_
;; lib.bb functions, same real swarm_handoff.bb send path via the
;; vector-form process/sh call) - used by the JS acceptance step handlers so
;; "the chase sweep runs" exercises the real mechanism, not a re-derived
;; approximation of it. Mirrors dropped_parcel_sweep_harness.bb's role
;; exactly for BL-678.
;;
;; Usage: batch_claim_progress_sweep_harness.bb <project-root> [staleness-ms] [cooldown-ms]
(ns batch-claim-progress-sweep-harness
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def project-root (first *command-line-args*))
(def staleness-ms
  (if-let [a (second *command-line-args*)]
    (parse-long a)
    chase-sweep-lib/batch-claim-progress-stale-default-threshold-ms))
(def cooldown-ms
  (if-let [a (nth *command-line-args* 2 nil)]
    (parse-long a)
    chase-sweep-lib/batch-claim-progress-cooldown-default-ms))
(def swarm-handoff-script (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "swarm_handoff.bb")))
(def cooldown-file (fs/path project-root ".swarmforge" "daemon" "batch-claim-progress-suspect-cooldown.json"))

(defn load-roles []
  (let [tsv (fs/path project-root ".swarmforge" "roles.tsv")]
    (into {}
          (for [line (str/split-lines (slurp (str tsv)))
                :when (not (str/blank? line))
                :let [[role worktree-name worktree-path session display agent receive-mode] (str/split line #"\t")]]
            [role {:role role :worktree-name worktree-name :worktree-path worktree-path
                   :session session :display display :agent agent :receive-mode (or receive-mode "task")}]))))

(defn head-commit-10 [role-info]
  (try
    (let [result (process/sh ["git" "rev-parse" "--short=10" "HEAD"] {:dir (:worktree-path role-info)})]
      (if (zero? (:exit result)) (str/trim (:out result)) ""))
    (catch Exception _ "")))

(defn write-scratch-draft! [lines]
  (let [tmp-dir (fs/path project-root ".swarmforge" "batch-claim-progress-drafts-test")]
    (fs/create-dirs tmp-dir)
    (let [draft (fs/path tmp-dir (str "draft-" (System/nanoTime) ".txt"))]
      (spit (str draft) (str (str/join "\n" lines) "\n"))
      draft)))

(defn read-cooldowns []
  (or (try (json/parse-string (slurp (str cooldown-file)) true) (catch Exception _ nil)) {}))

(defn last-sent-ms [file-path]
  (get (read-cooldowns) (keyword (fs/file-name file-path))))

(defn write-last-sent! [file-path now-ms]
  (fs/create-dirs (fs/parent cooldown-file))
  (spit (str cooldown-file) (json/generate-string (assoc (read-cooldowns) (keyword (fs/file-name file-path)) now-ms))))

;; SWARMFORGE_SKIP_SYNC_INJECT=1: the harness fixture has no live tmux
;; session, and real delivery (the tmux-dependent half of swarm_handoff.bb)
;; is already covered by that script's own test suite - this harness scopes
;; to what BL-678 adds, same posture as dropped_parcel_sweep_harness.bb.
(defn nudge! [suspect]
  (let [draft (write-scratch-draft!
               (chase-sweep-lib/batch-claim-progress-suspect-draft-lines (:item-id suspect) (:age-ms suspect)))
        env (merge (into {} (System/getenv)) {"SWARMFORGE_ROLE" "coordinator" "SWARMFORGE_SKIP_SYNC_INJECT" "1"})
        result (process/sh ["bb" swarm-handoff-script (str draft)] {:dir project-root :env env})]
    (println "NUDGED" (:item-id suspect) "exit=" (:exit result))))

(defn -main []
  (let [roles (load-roles)
        now-ms (System/currentTimeMillis)]
    (doseq [[role role-info] roles
            :when (= "batch" (:receive-mode role-info))]
      (let [in-process-dir (str (handoff-lib/mailbox-dir role-info :in_process))
            items (chase-sweep-lib/scan-in-process in-process-dir)
            current-commit (head-commit-10 role-info)
            suspects (chase-sweep-lib/apply-batch-claim-progress-check!
                      items now-ms staleness-ms current-commit)]
        (doseq [suspect suspects]
          (when-not (chase-sweep-lib/within-dropped-parcel-cooldown?
                     (last-sent-ms (:file-path suspect)) now-ms cooldown-ms)
            (nudge! suspect)
            (write-last-sent! (:file-path suspect) now-ms)))
        (println "SUSPECTS" role ":" (pr-str (mapv :item-id suspects)))))))

(-main)
