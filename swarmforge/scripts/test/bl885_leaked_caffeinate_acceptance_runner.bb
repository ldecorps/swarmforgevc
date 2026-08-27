#!/usr/bin/env bb
;; Acceptance runner for BL-885 (leaked caffeinate -dims reclaim): takes a
;; subcommand (argv 0) and a JSON payload (argv 1), prints a JSON result.
;; Same JSON-bridge pattern as bl886_vitest_orphan_reaper_acceptance_
;; runner.bb / bl849_orphan_janitor_acceptance_runner.bb, so the Node
;; acceptance step handlers drive the REAL orphan-janitor-sweep-lib/sweep!
;; wiring (including the new caffeinate reap class) without a Babashka<->JS
;; FFI. cwd is faked via the :cwd! adapter (never a real pidfile/process on
;; disk) - same convention bl886's janitor-side runner already established
;; for its own hung-vitest class.
(ns bl885-leaked-caffeinate-acceptance-runner
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

(def fixture-project-root "/bl885-fixture-root")
(def in-scope-cwd (str fixture-project-root "/extension"))
(def out-of-scope-cwd "/somewhere-else/not-this-project")

(defn- cwd-for [cwd-state]
  (case cwd-state
    "in-scope" in-scope-cwd
    "out-of-scope" out-of-scope-cwd
    "undeterminable" nil
    (throw (ex-info (str "bl885 acceptance runner: unknown cwdState " (pr-str cwd-state)) {}))))

;; Drives the REAL orphan-janitor-sweep-lib/sweep! and its new caffeinate
;; branch. Only the process-table/pidfile I/O adapters are faked (same
;; posture as every other JSON-bridge runner in this suite) - the reap
;; decision (reapable-leaked-caffeinate?, project-scoped-path?, the
;; caffeinate-stale-threshold-ms env read) is the unmodified production code.
(defn- run-sweep [{:keys [pid cmdline cwd-state age-ms live-caffeinate-pid]}]
  (let [kills (atom [])
        audits (atom [])
        adapters {:list-candidate-pids! (fn [] [pid])
                  :cmdline! (fn [_] cmdline)
                  :cwd! (fn [_] (cwd-for cwd-state))
                  :age-ms! (fn [_] age-ms)
                  :parent-orphaned?! (fn [_] true)
                  :live-window-pid-set! (fn [] #{})
                  :live-runtime-pid! (fn [] nil)
                  :live-caffeinate-pid! (fn [] live-caffeinate-pid)
                  :kill-pid! (fn [p] (swap! kills conj p))
                  :audit! (fn [line] (swap! audits conj line))
                  :log! (fn [_] nil)}]
    (orphan-janitor-sweep-lib/sweep! fixture-project-root adapters)
    {:reaped (= [pid] @kills) :audits @audits}))

(defmulti run identity)

(defmethod run "sweep-one-caffeinate" [_]
  (run-sweep {:pid (:pid payload)
              :cmdline (:cmdline payload)
              :cwd-state (:cwdState payload)
              :age-ms (:ageMs payload)
              :live-caffeinate-pid (:liveCaffeinatePid payload)}))

(println (json/generate-string (run subcommand)))
