#!/usr/bin/env bb
;; Acceptance runner for BL-1705 (orphan janitor reaps ghost ollama
;; runners and detached run clients). Same JSON-bridge pattern as
;; bl885_leaked_caffeinate_acceptance_runner.bb: drives the REAL
;; orphan-janitor-lib/reapable-ollama-ghost? and orphan-janitor-sweep-lib/
;; sweep! wiring so the Node acceptance step handlers never reimplement
;; the reap decision in JS. Only process-table I/O is faked.
(ns bl1705-ollama-ghost-janitor-acceptance-runner
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

(def fixture-project-root "/bl1705-fixture-root")

;; parentState -> the two booleans reapable-ollama-ghost? classifies over.
(defn- parent-flags [parent-state]
  (case parent-state
    "live-ollama-serve" {:parent-orphaned? false :parent-live-ollama-serve? true}
    "init" {:parent-orphaned? true :parent-live-ollama-serve? false}
    "live-shell" {:parent-orphaned? false :parent-live-ollama-serve? false}
    (throw (ex-info (str "bl1705 acceptance runner: unknown parentState " (pr-str parent-state)) {}))))

;; Drives the REAL reapable-ollama-ghost? predicate and the REAL grace
;; threshold's env read - only the parent-liveness signals are supplied
;; directly (the classification scenario names the parent by role, never
;; a raw pid/process, so there is nothing else to fake).
(defn- run-classify [{:keys [cmdline parent-state age-ms]}]
  (let [{:keys [parent-orphaned? parent-live-ollama-serve?]} (parent-flags parent-state)
        grace-ms (orphan-janitor-sweep-lib/ollama-run-client-grace-threshold-ms)]
    {:reaped (boolean
              (orphan-janitor-lib/reapable-ollama-ghost?
               {:in-live-window-set? false
                :cmdline cmdline
                :parent-orphaned? parent-orphaned?
                :parent-live-ollama-serve? parent-live-ollama-serve?
                :age-ms age-ms
                :grace-ms grace-ms}))}))

;; Drives the REAL sweep over two stand-in ollama processes: a ghost
;; runner (parent init) and a runner a live stand-in server still owns.
;; Only the process-table adapters are faked - the classification
;; (reapable-ollama-ghost?) and the ollama grace-threshold env read are
;; the unmodified production code. kill-pid! never touches a real
;; process; it just records which pid the sweep decided to reap.
(defn- run-sweep-two []
  (let [ghost-pid 910100
        owned-pid 910200
        kills (atom [])
        audits (atom [])
        ;; BL-1726: both marked as ollama's own worker (a path inside an
        ;; ollama installation's lib dir, a --model naming a blob) - the
        ;; ghost/owned split here tests the parent-liveness rule alone,
        ;; unchanged by BL-1726's narrower ownership check.
        own-cmdline "/usr/lib/ollama/llama-server --model /home/u/.ollama/models/blobs/sha256-64b5"
        cmdlines {ghost-pid own-cmdline
                  owned-pid own-cmdline}
        adapters {:list-candidate-pids! (fn [] [ghost-pid owned-pid])
                  :cmdline! (fn [p] (get cmdlines p))
                  :cwd! (fn [_] nil)
                  :age-ms! (fn [_] (* 3 3600000))
                  :parent-orphaned?! (fn [p] (= p ghost-pid))
                  :parent-live-ollama-serve?! (fn [p] (= p owned-pid))
                  :live-window-pid-set! (fn [] #{})
                  :live-runtime-pid! (fn [] nil)
                  :live-caffeinate-pid! (fn [] nil)
                  :kill-pid! (fn [p] (swap! kills conj p))
                  :audit! (fn [line] (swap! audits conj line))
                  :log! (fn [_] nil)}]
    (orphan-janitor-sweep-lib/sweep! fixture-project-root adapters)
    {:ghost-pid ghost-pid
     :owned-pid owned-pid
     :ghost-reaped (boolean (some #{ghost-pid} @kills))
     :owned-reaped (boolean (some #{owned-pid} @kills))
     :audits @audits}))

(defmulti run identity)

(defmethod run "classify" [_]
  (run-classify {:cmdline (:cmdline payload)
                 :parent-state (:parentState payload)
                 :age-ms (:ageMs payload)}))

(defmethod run "sweep-two-ollama" [_]
  (run-sweep-two))

(println (json/generate-string (run subcommand)))
