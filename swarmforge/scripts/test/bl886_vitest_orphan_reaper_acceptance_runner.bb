#!/usr/bin/env bb
;; Acceptance runner for BL-886 (janitor side, scenarios 04/05): takes a
;; subcommand (argv 0) and a JSON payload (argv 1), prints a JSON result.
;; Same JSON-bridge pattern as bl879_parent_orphaned_front_desk_acceptance_
;; runner.bb / bl849_orphan_janitor_acceptance_runner.bb, so the Node
;; acceptance step handlers drive the REAL orphan-janitor-sweep-lib/sweep!
;; wiring (the landed hotfix under review, commit 1ecbe049f) without a
;; Babashka<->JS FFI. The supervisor-side scenarios (01-03) are driven
;; directly by real spawned processes from the step handlers instead -
;; handoffd_supervisor.bb self-executes (-main) on load, so it cannot be
;; load-file'd for a JSON bridge the way this janitor library can.
(ns bl886-vitest-orphan-reaper-acceptance-runner
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

(def candidate-pid 5252)
(def vitest-cmdline "npm exec vitest run --config vitest.properties.config.mjs --reporter=json")
;; Does not need to exist on disk - fs/canonicalize normalizes a path
;; without requiring it, same contract handoffd_supervisor.bb's own
;; canonical-path relies on.
(def fixture-project-root "/bl886-fixture-root")
(def fixture-cwd (str fixture-project-root "/extension"))

(defn- parent-orphaned-adapter [parent-state]
  (case parent-state
    "gone" {:parent-orphaned?! (fn [_] true)}
    "alive" {:parent-orphaned?! (fn [_] false)}
    {}))

;; scenario 04/05: a project-scoped hung vitest tree, gated on parenthood +
;; staleness. cwd is fixed under fixture-project-root so project-scoped-path?
;; (the real, unmocked function) is satisfied genuinely, never stubbed.
(defn- run-sweep [{:keys [cmdline age-ms parent-state]}]
  (let [kills (atom [])
        audits (atom [])
        base-adapters {:list-candidate-pids! (fn [] [candidate-pid])
                        :cmdline! (fn [_] cmdline)
                        :cwd! (fn [_] fixture-cwd)
                        :age-ms! (fn [_] age-ms)
                        :live-window-pid-set! (fn [] #{})
                        :live-runtime-pid! (fn [] nil)
                        :kill-pid! (fn [pid] (swap! kills conj pid))
                        :audit! (fn [line] (swap! audits conj line))
                        :log! (fn [_] nil)}
        adapters (merge base-adapters (parent-orphaned-adapter parent-state))]
    (orphan-janitor-sweep-lib/sweep! fixture-project-root adapters)
    {:reaped (= [candidate-pid] @kills) :audits @audits}))

(defmulti run identity)

(defmethod run "sweep-one-vitest" [_]
  (run-sweep {:cmdline vitest-cmdline
              :age-ms (:ageMs payload)
              :parent-state (:parentState payload)}))

(println (json/generate-string (run subcommand)))
