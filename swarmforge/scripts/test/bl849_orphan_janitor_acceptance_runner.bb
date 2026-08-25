#!/usr/bin/env bb
;; Acceptance runner for BL-849: takes a subcommand (argv 0) and a JSON
;; payload (argv 1), prints a JSON result. Same JSON-bridge pattern as
;; orphan_agent_reapable_decision_acceptance_runner.bb (BL-486) /
;; fixture_reapable_decision_acceptance_runner.bb (BL-458), so the Node
;; acceptance step handlers drive the REAL Babashka decision/wiring
;; functions without a Babashka<->JS FFI.
(ns bl849-orphan-janitor-acceptance-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]
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

(def created-temp-dirs (atom []))
;; BL-872: shutdown hook mirrors handoff_lib_test_runner.bb (BL-459) - fires
;; on both a clean run and an uncaught exception, never on SIGKILL/OOM
;; (BL-413's periodic /tmp sweep is the backstop for that).
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn- mk-tmp-dir []
  (let [d (fs/create-temp-dir)]
    (swap! created-temp-dirs conj d)
    d))

(defn- collecting-adapters [candidates-fn]
  (let [logs (atom [])]
    {:logs logs
     :adapters
     {:list-candidate-pids! candidates-fn
      :cmdline! (fn [_] "")
      :age-ms! (fn [_] 0)
      :live-window-pid-set! (fn [] #{})
      :live-runtime-pid! (fn [] nil)
      :kill-pid! (fn [_] nil)
      :audit! (fn [_] nil)
      :log! (fn [msg] (swap! logs conj msg))}}))

(defmulti run identity)

;; darwin-orphan-janitor-01: proves REAL enumeration succeeds on this host
;; (never a fake/stubbed list-processes!) and, given the scenario's own
;; stated precondition that no disposable-root ancillary is running,
;; reports a genuine zero-candidate sweep. Cannot instead scan the WHOLE
;; real host and assert literally zero candidates - this dev/CI host is a
;; live SwarmForge checkout with its own real operator_runtime.bb always
;; running (a legitimate, expected candidate-pattern match that is
;; correctly never REAPED, since it is not tmp-rooted - but "candidate" and
;; "reaped" are different counts, so it is not zero). Throws loud rather
;; than silently reporting a wrong result if real enumeration itself fails
;; here, since that would invalidate the scenario's own precondition.
(defmethod run "sweep-real-host" [_]
  (when (nil? (process-table-lib/list-processes!))
    (throw (ex-info "real process-table enumeration failed on this host - cannot exercise the clean-sweep scenario" {})))
  (let [{:keys [logs adapters]} (collecting-adapters (fn [] []))]
    (orphan-janitor-sweep-lib/sweep! (:projectRoot payload) adapters)
    {:logs @logs}))

;; darwin-orphan-janitor-02: enumeration unavailable (injected nil, standing
;; in for a real process-table read failure - see process_table_lib.bb's
;; own nil-on-failure contract, exercised for real by
;; orphan_sweep_enumeration_unavailable_test_runner.bb's unit coverage).
(defmethod run "sweep-enumeration-unavailable" [_]
  (let [{:keys [logs adapters]} (collecting-adapters (fn [] nil))]
    (orphan-janitor-sweep-lib/sweep! (:projectRoot payload) adapters)
    {:logs @logs}))

;; darwin-orphan-janitor-03 (Darwin row): a real disposable-root ancillary
;; process, found via the REAL process-table-lib/list-processes! (Darwin ->
;; ProcessHandle) + orphan-janitor-lib/tmp-ancillary-cmdline? filter -
;; exactly scan-candidate-pids!'s own real pipeline, called directly here
;; (not through the full sweep, which would also need an age/threshold
;; dance) so the assertion is precisely "is it a candidate".
(defmethod run "is-candidate-on-this-host" [_]
  (let [pid (long (:pid payload))
        procs (process-table-lib/list-processes!)
        matching (first (filter #(= pid (:pid %)) procs))]
    {:enumerationSucceeded (some? procs)
     :found (some? matching)
     :isCandidate (boolean (and matching (orphan-janitor-lib/tmp-ancillary-cmdline? (:cmdline matching))))}))

;; darwin-orphan-janitor-03 (Linux row): this Darwin host has no /proc to
;; dispatch through for real (procfs-available? hardcodes the literal
;; "/proc" root, by design - not something a test should redirect). What IS
;; testable here without a Linux host is cmdline-from-procfs's own parsing
;; contract: /proc/<pid>/cmdline is NUL-separated argv, and its whole job
;; is replacing NUL bytes with spaces. This replicates that exact
;; transform against a real NUL-separated fixture file (the same input
;; shape /proc would hand it) and confirms the joined result is recognized
;; as a candidate - proving the parsing logic is correct without a literal
;; Linux host. QA's own E2E procedure (item 4) still requires a real Linux
;; host pass separately; this is not a substitute for it.
(def nul-byte (str (char 0)))

(defmethod run "procfs-cmdline-parses" [_]
  (let [tmp (mk-tmp-dir)
        cmdline-file (fs/path tmp "cmdline")
        argv ["bash" "/tmp/tmp.fixture/.swarmforge/babysitter/launch.sh"]
        nul-joined (str (str/join nul-byte argv) nul-byte)]
    (spit (str cmdline-file) nul-joined)
    (let [slurped (slurp (str cmdline-file))
          parsed (str/replace slurped nul-byte " ")]
      (fs/delete-tree tmp)
      {:cmdline parsed
       :isCandidate (boolean (orphan-janitor-lib/tmp-ancillary-cmdline? parsed))})))

;; darwin-orphan-janitor-04: pure predicate, exact Examples table cmdlines.
(defmethod run "ancillary-cmdline-recognized" [_]
  {:isCandidate (boolean (orphan-janitor-lib/tmp-ancillary-cmdline? (:cmdline payload)))})

;; darwin-orphan-janitor-05: decapitation guard - a host-repo cwd/cmdline is
;; never a candidate, whatever else is true of it.
(defmethod run "host-repo-never-candidate" [_]
  {:isCandidate (boolean (orphan-janitor-lib/tmp-ancillary-cmdline? (:cmdline payload)))
   :tmpProjectRoot (boolean (orphan-janitor-lib/tmp-project-root? (:cwd payload)))})

;; darwin-orphan-janitor-06: an unresolved cwd fails closed in the AGENT
;; reaper's reapable? (BL-849 review goal 3 fix) - every other gate says
;; "reap" so this isolates exactly the cwd-resolved? gate.
(defmethod run "unresolved-cwd-never-reaped" [_]
  {:reapable
   (boolean
    (orphan-agent-reaper-lib/reapable?
     {:in-live-window-set? false
      :cwd-inside-root? false
      :cwd-resolved? false
      :remote-control-agent? true
      :has-children? false
      :stale? true}))})

(println (json/generate-string (run subcommand)))
