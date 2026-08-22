#!/usr/bin/env bb
;; Test-only harness: runs one dropped-parcel sweep pass against a fixture
;; project root, mirroring handoffd.bb's dropped-parcel-sweep!/nudge-
;; coordinator-dropped-parcel! exactly (same chase_sweep_lib.bb functions,
;; same real swarm_handoff.bb send path via the vector-form process/sh
;; call) - used by the JS acceptance step handlers
;; (specs/pipeline/steps/droppedParcelSteps.js) so "the sweep runs"
;; exercises the real mechanism, not a re-derived approximation of it.
;; Mirrors dispatch_gap_sweep_harness.bb's role exactly for BL-719.
;;
;; Usage: dropped_parcel_sweep_harness.bb <project-root> [stall-threshold-ms] [cooldown-ms]
(ns dropped-parcel-sweep-harness
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def project-root (first *command-line-args*))
(def stall-threshold-ms
  (if-let [a (second *command-line-args*)]
    (parse-long a)
    chase-sweep-lib/dropped-parcel-stall-default-threshold-ms))
(def cooldown-ms
  (if-let [a (nth *command-line-args* 2 nil)]
    (parse-long a)
    chase-sweep-lib/dropped-parcel-cooldown-default-ms))
(def swarm-handoff-script (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "swarm_handoff.bb")))
(def cooldown-file (fs/path project-root ".swarmforge" "daemon" "dropped-parcel-nudge-cooldown.json"))

(defn load-roles []
  (let [tsv (fs/path project-root ".swarmforge" "roles.tsv")]
    (into {}
          (for [line (str/split-lines (slurp (str tsv)))
                :when (not (str/blank? line))
                :let [[role worktree-name worktree-path session display agent receive-mode] (str/split line #"\t")]]
            [role {:role role :worktree-name worktree-name :worktree-path worktree-path
                   :session session :display display :agent agent :receive-mode (or receive-mode "task")}]))))

(defn all-scan-dirs [roles]
  (vec (for [[_ role-info] roles
             state [:new :in_process :completed :sent :outbox]]
         (str (handoff-lib/mailbox-dir role-info state)))))

(defn live-mail-dirs [roles]
  (vec (for [[_ role-info] roles
             state [:new :in_process]]
         (str (handoff-lib/mailbox-dir role-info state)))))

(defn write-scratch-draft! [lines]
  (let [tmp-dir (fs/path project-root ".swarmforge" "dropped-parcel-drafts-test")]
    (fs/create-dirs tmp-dir)
    (let [draft (fs/path tmp-dir (str "draft-" (System/nanoTime) ".txt"))]
      (spit (str draft) (str (str/join "\n" lines) "\n"))
      draft)))

(defn read-cooldowns []
  (or (try (json/parse-string (slurp (str cooldown-file)) true) (catch Exception _ nil)) {}))

(defn last-sent-ms [item-id]
  (get (read-cooldowns) (keyword item-id)))

(defn write-last-sent! [item-id now-ms]
  (fs/create-dirs (fs/parent cooldown-file))
  (spit (str cooldown-file) (json/generate-string (assoc (read-cooldowns) (keyword item-id) now-ms))))

;; SWARMFORGE_SKIP_SYNC_INJECT=1: the harness fixture has no live tmux
;; session, and real delivery (the tmux-dependent half of swarm_handoff.bb)
;; is already covered by that script's own test suite - this harness scopes
;; to what BL-719 adds, same posture as dispatch_gap_sweep_harness.bb.
(defn nudge! [item]
  (let [draft (write-scratch-draft! (chase-sweep-lib/dropped-parcel-draft-lines item))
        env (merge (into {} (System/getenv)) {"SWARMFORGE_ROLE" "coordinator" "SWARMFORGE_SKIP_SYNC_INJECT" "1"})
        result (process/sh ["bb" swarm-handoff-script (str draft)] {:dir project-root :env env})]
    (println "NUDGED" (:id item) "exit=" (:exit result))))

(defn -main []
  (let [roles (load-roles)
        now-ms (System/currentTimeMillis)
        candidates (chase-sweep-lib/dropped-parcel-items
                    (str (fs/path project-root "backlog" "active"))
                    (all-scan-dirs roles) (live-mail-dirs roles) now-ms stall-threshold-ms)]
    (doseq [item candidates]
      (when-not (chase-sweep-lib/within-dropped-parcel-cooldown?
                 (last-sent-ms (:id item)) now-ms cooldown-ms)
        (nudge! item)
        (write-last-sent! (:id item) now-ms)))
    (println "CANDIDATES:" (pr-str (mapv :id candidates)))))

(-main)
