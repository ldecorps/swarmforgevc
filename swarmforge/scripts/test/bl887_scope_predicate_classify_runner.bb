#!/usr/bin/env bb
;; BL-887: JSON bridge exposing the janitor's real project-scoped-path? for
;; a given (cmd, cwd) pair against a fixture project root - same JSON-bridge
;; pattern as bl886_vitest_orphan_reaper_acceptance_runner.bb, so the Node
;; acceptance step handlers drive the REAL orphan_janitor_lib.bb wiring
;; without a Babashka<->JS FFI. The supervisor-side scenarios are driven
;; directly by real spawned processes from the step handlers instead (via
;; lib/bl886SupervisorFixture.js) - handoffd_supervisor.bb self-executes
;; (-main) on load, so it cannot be load-file'd for a JSON bridge the way
;; orphan_janitor_lib.bb can (see bl886_vitest_orphan_reaper_acceptance_
;; runner.bb's own header for the same reasoning).
;;
;; Subcommand "classify", payload {"projectRoot": ..., "worktree": ...,
;; "cmd": ..., "cwd": ...} (cwd may be JSON null). Writes a roles.tsv
;; registering worktree under projectRoot/.swarmforge/ (idempotent - safe
;; to call repeatedly against the same fixture) then returns
;; {"inScope": bool} from the real, unmocked project-scoped-path?.
;;
;; Subcommand "sweep-worker" (scenario 02: a hung live-parented worker
;; becomes a reap candidate), payload adds "ageMs" and "parentState" ("gone"
;; or "alive"), drives the REAL orphan-janitor-sweep-lib/sweep! wiring (same
;; pattern as bl886_vitest_orphan_reaper_acceptance_runner.bb's own
;; "sweep-one-vitest", generalized to an arbitrary cmdline/cwd rather than
;; that runner's fixed vitest-cmdline/fixture-cwd constants) and returns
;; {"reaped": bool}.
(ns bl887-scope-predicate-classify-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(def here (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path here ".." "orphan_janitor_lib.bb")))
(load-file (str (fs/path here ".." "process_table_lib.bb")))
(load-file (str (fs/path here ".." "orphan_agent_reaper_lib.bb")))
(load-file (str (fs/path here ".." "proc_fd_scan_lib.bb")))
(load-file (str (fs/path here ".." "orphan_agent_reaper_sweep_lib.bb")))
(load-file (str (fs/path here ".." "orphan_janitor_sweep_lib.bb")))

(def subcommand (first *command-line-args*))
(def payload (when-let [raw (second *command-line-args*)] (json/parse-string raw true)))

(defn- ensure-roles-tsv! [project-root worktree]
  (let [swarmforge-dir (fs/path project-root ".swarmforge")
        roles-file (fs/path swarmforge-dir "roles.tsv")]
    (fs/create-dirs swarmforge-dir)
    (fs/create-dirs worktree)
    (spit (str roles-file)
          (str "coder\tcoder\t" worktree "\tswarmforge-coder\tCoder\tclaude\ttask\n"))))

(def candidate-pid 8787)

(defn- run-sweep-worker [{:keys [project-root cmd cwd age-ms parent-state]}]
  (let [kills (atom [])
        adapters {:list-candidate-pids! (fn [] [candidate-pid])
                  :cmdline! (fn [_] cmd)
                  :cwd! (fn [_] cwd)
                  :age-ms! (fn [_] age-ms)
                  :parent-orphaned?! (fn [_] (= parent-state "gone"))
                  :live-window-pid-set! (fn [] #{})
                  :live-runtime-pid! (fn [] nil)
                  :kill-pid! (fn [pid] (swap! kills conj pid))
                  :audit! (fn [_] nil)
                  :log! (fn [_] nil)}]
    (orphan-janitor-sweep-lib/sweep! project-root adapters)
    {:reaped (= [candidate-pid] @kills)}))

(defmulti run identity)

(defmethod run "classify" [_]
  (let [{:keys [projectRoot worktree cmd cwd]} payload]
    (ensure-roles-tsv! projectRoot worktree)
    {:inScope (orphan-janitor-lib/project-scoped-path? projectRoot cmd cwd)}))

(defmethod run "sweep-worker" [_]
  (let [{:keys [projectRoot worktree cmd cwd ageMs parentState]} payload]
    (ensure-roles-tsv! projectRoot worktree)
    (run-sweep-worker {:project-root projectRoot :cmd cmd :cwd cwd
                        :age-ms ageMs :parent-state parentState})))

(println (json/generate-string (run subcommand)))
