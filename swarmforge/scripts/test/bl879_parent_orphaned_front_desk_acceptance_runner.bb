#!/usr/bin/env bb
;; Acceptance runner for BL-879: takes a subcommand (argv 0) and a JSON
;; payload (argv 1), prints a JSON result. Same JSON-bridge pattern as
;; bl849_orphan_janitor_acceptance_runner.bb / orphan_agent_reapable_
;; decision_acceptance_runner.bb (BL-486), so the Node acceptance step
;; handlers drive the REAL Babashka decision/wiring functions (the landed
;; fix under review, commit 36ea0109e9) without a Babashka<->JS FFI.
(ns bl879-parent-orphaned-front-desk-acceptance-runner
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

(def candidate-pid 4242)

;; :not-determinable leaves :parent-orphaned?! entirely unwired (no key at
;; all) - the same "probe failure never reads as orphaned" fallback P3d in
;; bl879_parent_orphaned_front_desk_property_runner.bb exercises, here
;; driven end to end through the acceptance JSON bridge instead.
(defn- parent-orphaned-adapter [parent-state]
  (case parent-state
    "gone" {:parent-orphaned?! (fn [_] true)}
    "alive" {:parent-orphaned?! (fn [_] false)}
    {}))

(defn- run-sweep [{:keys [cmdline age-ms parent-state in-live-window]}]
  (let [kills (atom [])
        audits (atom [])
        logs (atom [])
        base-adapters {:list-candidate-pids! (fn [] [candidate-pid])
                        :cmdline! (fn [_] cmdline)
                        :age-ms! (fn [_] age-ms)
                        :live-window-pid-set! (fn [] (if in-live-window #{candidate-pid} #{}))
                        :live-runtime-pid! (fn [] nil)
                        :kill-pid! (fn [pid] (swap! kills conj pid))
                        :audit! (fn [line] (swap! audits conj line))
                        :log! (fn [msg] (swap! logs conj msg))}
        adapters (merge base-adapters (parent-orphaned-adapter parent-state))]
    (orphan-janitor-sweep-lib/sweep! "/irrelevant" adapters)
    {:reaped (= [candidate-pid] @kills)
     :isCandidate (boolean (orphan-janitor-lib/tmp-ancillary-cmdline? cmdline))
     :tmpProjectRoot (boolean (orphan-janitor-lib/tmp-project-root?
                                (orphan-janitor-lib/parse-tmp-ancillary-root cmdline)))
     :audits @audits
     :logs @logs}))

(defmulti run identity)

;; parent-orphaned-front-desk-01/02/05: a fresh, disposable-root front-desk
;; process under a given parent state (and optionally in the live window
;; set).
(defmethod run "sweep-one-ancillary" [_]
  (run-sweep {:cmdline (:cmdline payload)
              :age-ms (if (:fresh payload) 1000 999999999)
              :parent-state (:parentState payload)
              :in-live-window (boolean (:inLiveWindow payload))}))

(println (json/generate-string (run subcommand)))
