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
;; Usage: batch_claim_progress_sweep_harness.bb <project-root> [staleness-ms] [cooldown-ms] [clean|dirty]
;; Pass "-" for staleness-ms or cooldown-ms to take the default. BL-1076 needs
;; the fourth argument without pinning the first two, and "-" says "default"
;; without inventing a flag parser in a test harness.
(ns batch-claim-progress-sweep-harness
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def project-root (first *command-line-args*))

(defn- arg-at [i]
  (let [a (nth *command-line-args* i nil)]
    (when-not (or (nil? a) (= "-" a)) a)))

;; An explicit staleness pins the window for every role, as it did before
;; BL-1076. Absent (or "-"), each role resolves its own - which is the whole
;; point of the ticket, so the harness must be able to exercise both.
(def explicit-staleness-ms (some-> (arg-at 1) parse-long))
(def staleness-ms
  (or explicit-staleness-ms chase-sweep-lib/batch-claim-progress-stale-default-threshold-ms))
(def cooldown-ms
  (or (some-> (arg-at 2) parse-long) chase-sweep-lib/batch-claim-progress-cooldown-default-ms))
;; BL-1076: the owner's worktree dirtiness, the second progress signal beside
;; HEAD. The daemon reads it with `git status --porcelain` in the role's
;; worktree; the fixture roots this harness runs against are not real
;; worktrees, so it is passed in - the point is to mirror the daemon's CALL
;; SHAPE, not to re-derive its adapter. Absent means clean, which is what
;; every pre-BL-1076 caller of this harness meant.
(def worktree-dirty? (= "dirty" (arg-at 3)))
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
        now-ms (System/currentTimeMillis)
        role-overrides (chase-sweep-lib/parse-batch-claim-progress-role-stale-threshold-ms
                        (try (slurp (str (fs/path project-root "swarmforge" "swarmforge.conf")))
                             (catch Exception _ nil)))]
    (doseq [[role role-info] roles
            :when (= "batch" (:receive-mode role-info))]
      (let [in-process-dir (str (handoff-lib/mailbox-dir role-info :in_process))
            items (chase-sweep-lib/scan-in-process in-process-dir)
            current-commit (head-commit-10 role-info)
            ;; BL-1076: resolved per role, exactly as batch-claim-progress-
            ;; sweep! does. An explicit staleness-ms argument still wins, so
            ;; the pre-BL-1076 callers of this harness are unaffected.
            role-stale-ms (or explicit-staleness-ms
                             (batch-claim-progress-lib/resolve-stale-threshold-ms
                              role staleness-ms role-overrides))
            {:keys [suspects suppressed]}
            (chase-sweep-lib/apply-batch-claim-progress-check!
             items now-ms role-stale-ms current-commit worktree-dirty?)]
        (doseq [suspect suspects]
          (when-not (chase-sweep-lib/within-dropped-parcel-cooldown?
                     (last-sent-ms (:file-path suspect)) now-ms cooldown-ms)
            (nudge! suspect)
            (write-last-sent! (:file-path suspect) now-ms)))
        ;; Mirrors the daemon's own log! line: a suppression is never silent.
        (doseq [item suppressed]
          (println "SUPPRESSED" (:item-id item) (:reason item)
                   (str (quot (:age-ms item) 60000) "m")))
        (println "SUSPECTS" role ":" (pr-str (mapv :item-id suspects)))))))

(-main)
