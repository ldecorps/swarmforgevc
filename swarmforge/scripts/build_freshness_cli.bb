#!/usr/bin/env bb

;; BL-328: the one shell-callable entry point for build_freshness_lib.bb's
;; staleness decision - the coordinator calls this to detect AND close the
;; loop on merged code that never reached the running daemons (mirrors
;; role_lifecycle_cli.bb/quiet_period_gate_cli.bb's own CLI-wrapper shape).
;; Never reimplements the staleness decision itself - build_freshness_lib.bb
;; stays the single source of truth; this file gathers real state (each
;; process's own captured build_sha, main's own current HEAD), calls it,
;; and - for `sync` - recompiles/restarts via each process's OWN EXISTING
;; launch mechanism (start_handoff_daemon.sh, launch_front_desk.sh, a
;; direct nohup for operator_runtime.bb's own stop-file/pid-file
;; convention) - never a second parallel restart mechanism.
;;
;; SINGLE OWNER: this CLI is the ONE place a recompile+restart is
;; triggered from. Nothing else in this codebase auto-restarts these
;; processes on a merge - the coordinator calls `sync` explicitly (a
;; deliberate design choice, not a background poller), so nothing restarts
;; without a real decision behind it.
;;
;; Usage:
;;   build_freshness_cli.bb <project-root> report
;;     Prints a JSON array, one entry per tracked process:
;;     {"name":..., "running_sha":..., "main_sha":..., "stale":true|false}.
;;     Exit 0 always - an unresolvable identity just reads as not-stale
;;     (never fabricate an answer).
;;   build_freshness_cli.bb <project-root> sync
;;     Recompiles extension/ (once, if any Node-backed process is stale),
;;     then restarts every stale process's own GROUP via its existing
;;     mechanism. Prints {"report":[...], "restarted":[...]}. Exit 0 on
;;     success, exit 2 if any restart step failed.

(ns build-freshness-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/path (fs/parent (fs/canonicalize *file*)))))

(load-file (str (fs/path script-dir "build_freshness_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: build_freshness_cli.bb <project-root> report | sync"))
  (System/exit 2))

;; ── real state gathering ────────────────────────────────────────────────

(defn- read-json-file [f]
  (try (json/parse-string (slurp (str f)) true) (catch Exception _ nil)))

(defn- main-sha! [project-root]
  (let [{:keys [exit out]} (process/sh {:continue true :dir project-root} "git" "rev-parse" "main")]
    (when (zero? exit) (str/trim out))))

(defn- front-desk-status [project-root]
  (read-json-file (fs/path project-root ".swarmforge" "operator" "front-desk-supervisor.status.json")))

(defn- handoffd-build [project-root]
  (read-json-file (fs/path project-root ".swarmforge" "daemon" "handoffd-build.json")))

(defn- operator-status [project-root]
  (read-json-file (fs/path project-root ".swarmforge" "operator" "status.json")))

;; The 6 processes the ticket's own AFFECTED list names, grouped by their
;; real restart unit (a group is torn down/brought back up TOGETHER - see
;; restart-front-desk-group!/restart-handoffd-group! below for why a
;; per-process restart is not meaningful for the front-desk trio).
(defn- gather-processes [project-root]
  (let [fd (front-desk-status project-root)
        hb (handoffd-build project-root)
        op (operator-status project-root)]
    [{:name "bridge" :group :front-desk :running-sha (:build_sha (:bridge fd))}
     {:name "bot" :group :front-desk :running-sha (:build_sha (:bot fd))}
     {:name "front_desk_supervisor" :group :front-desk :running-sha (:supervisor_build_sha fd)}
     {:name "handoffd" :group :handoffd :running-sha (:build_sha hb)}
     {:name "handoffd_supervisor" :group :handoffd :running-sha (:build_sha hb)}
     {:name "operator_runtime" :group :operator :running-sha (:build_sha op)}]))

(defn- run-report! [project-root]
  (let [processes (gather-processes project-root)
        main-sha (main-sha! project-root)]
    (build-freshness-lib/freshness-report processes main-sha)))

;; ── restart primitives (kill-and-confirm, mirrors handoffd_supervisor.bb's
;;    own TERM-then-escalate-to-SIGKILL convention and timing) ────────────

(def kill-timeout-ms 5000)

(defn- read-pid [pid-file]
  (when (fs/exists? pid-file)
    (try (Long/parseLong (str/trim (slurp (str pid-file)))) (catch Exception _ nil))))

(defn- pid-alive? [pid]
  (when pid
    (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.isAlive))))

(defn- wait-until-dead [pid timeout-ms]
  (let [deadline (+ (System/currentTimeMillis) timeout-ms)]
    (loop []
      (cond
        (not (pid-alive? pid)) true
        (> (System/currentTimeMillis) deadline) false
        :else (do (Thread/sleep 100) (recur))))))

(defn- kill-and-confirm! [pid]
  (if-not (pid-alive? pid)
    true
    (do
      (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.destroy))
      (or (wait-until-dead pid kill-timeout-ms)
          (do
            (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.destroyForcibly))
            (wait-until-dead pid kill-timeout-ms))))))

(defn- recompile-extension! [project-root]
  (let [{:keys [exit err]} (process/sh {:continue true :dir (str (fs/path project-root "extension"))} "npm" "run" "compile")]
    (when-not (zero? exit)
      (throw (ex-info (str "npm run compile failed: " err) {:step :recompile})))))

;; The front-desk trio (bridge/bot/front_desk_supervisor) is restarted as
;; ONE UNIT, never independently: bridge/bot are DETACHED OS processes
;; (front_desk_supervisor.bb's own header comment - they outlive their
;; supervisor's own exit), so killing just the supervisor would leave the
;; OLD bridge/bot still running the stale build with nobody about to
;; notice; and launch_front_desk.sh is idempotent (refuses to double-start
;; while its own pid is alive), so it must be stopped first, not just
;; re-invoked. BL-320's persisted reply-outbox cursor is what makes this
;; safe for in-flight messages (replay-on-reconnect), not anything special
;; about the restart sequence itself.
(defn- restart-front-desk-group! [project-root]
  (let [fd (front-desk-status project-root)
        sup-pid-file (fs/path project-root ".swarmforge" "operator" "front-desk-supervisor.pid")
        sup-pid (read-pid sup-pid-file)
        bridge-pid (:pid (:bridge fd))
        bot-pid (:pid (:bot fd))]
    (kill-and-confirm! sup-pid)
    (kill-and-confirm! bridge-pid)
    (kill-and-confirm! bot-pid)
    (fs/delete-if-exists sup-pid-file)
    (fs/delete-if-exists (fs/path project-root ".swarmforge" "operator" "front-desk-supervisor.status.json"))
    (let [{:keys [exit err]} (process/sh {:continue true} "bash" (str (fs/path script-dir "launch_front_desk.sh")) project-root)]
      (when-not (zero? exit)
        (throw (ex-info (str "launch_front_desk.sh failed: " err) {:step :restart-front-desk}))))))

;; start_handoff_daemon.sh already stops both pids before starting fresh -
;; reused as-is, never a second stop-then-start implementation.
(defn- restart-handoffd-group! [project-root]
  (let [{:keys [exit err]} (process/sh {:continue true} "bash" (str (fs/path script-dir "start_handoff_daemon.sh")) project-root)]
    (when-not (zero? exit)
      (throw (ex-info (str "start_handoff_daemon.sh failed: " err) {:step :restart-handoffd})))))

;; BL-433 (human-decided 2026-07-16): the single sync pass's own settle bound
;; - a normal first tick (spawn + Babashka load + status write) is ~1-5s, so
;; 10s is generous headroom, not a build-time free choice. Overridable so a
;; test can drive the "never settles" failure path in milliseconds rather
;; than really waiting out the full bound (mirrors OPERATOR_AWAIT_TIMEOUT_MS's
;; own env-override seam elsewhere in this codebase).
(def operator-settle-timeout-ms (or (some-> (System/getenv "BUILD_FRESHNESS_OPERATOR_SETTLE_TIMEOUT_MS") parse-long) 10000))
(def operator-settle-poll-ms 100)

;; BL-433: blocks until operator-status reports :build_sha == expected-sha,
;; or timeout-ms elapses - returns the last-read status (possibly still
;; stale/nil) either way, so the caller decides whether that counts as
;; settled. Bounded per the engineering article's "every wait is bounded"
;; rule - never an unbounded poll.
(defn- wait-for-fresh-operator-status [project-root expected-sha timeout-ms]
  (let [deadline (+ (System/currentTimeMillis) timeout-ms)]
    (loop []
      (let [status (operator-status project-root)]
        (cond
          (= (:build_sha status) expected-sha) status
          (> (System/currentTimeMillis) deadline) status
          :else (do (Thread/sleep operator-settle-poll-ms) (recur)))))))

;; operator_runtime.bb owns a graceful stop-file convention (the SAME one
;; handoffd_supervisor.bb's own loop uses) - touched here rather than a
;; bare kill, then kill-and-confirm! as the bounded fallback if the running
;; tick does not notice in time (BL-481: the loop re-checks stop-file every
;; short OPERATOR_POLL_INTERVAL_MS wake now, not every full
;; OPERATOR_INTERVAL_MS - still bounded by however long a single in-progress
;; tick!/poll! call takes to return).
;;
;; BL-433: restart-front-desk-group! already deletes its own status.json
;; before relaunching (so no consumer reads a stale one during the restart
;; window); this group never did. Fixed here the same way: delete
;; status.json right after the old process is confirmed dead, THEN launch
;; the new one, THEN block (bounded) until it reappears fresh. A settle
;; failure THROWS (the same ex-info convention every other restart step
;; here already uses), so run-sync!'s existing catch-all reports it as a
;; loud, non-zero-exit failure instead of a silent/false-fresh report.
(defn- restart-operator-group! [project-root main-sha]
  (let [op-dir (fs/path project-root ".swarmforge" "operator")
        stop-file (fs/path op-dir "stop")
        pid-file (fs/path op-dir "runtime.pid")
        pid (read-pid pid-file)
        log-file (fs/path op-dir "runtime.log")
        status-file (fs/path op-dir "status.json")]
    (fs/create-dirs op-dir)
    (spit (str stop-file) "")
    (when-not (wait-until-dead pid 10000)
      (kill-and-confirm! pid))
    (fs/delete-if-exists stop-file)
    (fs/delete-if-exists pid-file)
    (fs/delete-if-exists status-file)
    (process/process {:out (str log-file) :err (str log-file) :dir project-root}
                      "bb" (str (fs/path script-dir "operator_runtime.bb")) project-root)
    (let [settled (wait-for-fresh-operator-status project-root main-sha operator-settle-timeout-ms)]
      (when-not (= (:build_sha settled) main-sha)
        (throw (ex-info (str "operator_runtime did not publish fresh status within " operator-settle-timeout-ms "ms")
                         {:step :restart-operator-settle}))))))

;; BL-433: restart-group!'s values are now uniformly arity-2 (project-root,
;; main-sha) so run-sync! below can dispatch through ONE call shape - only
;; the operator restart actually needs main-sha (to know what "fresh" means
;; for its own settle-wait); front-desk/handoffd simply ignore it, exactly
;; the same "never a regression for groups that do not have this race"
;; posture the ticket itself requires.
(def restart-group!
  {:front-desk (fn [project-root _main-sha] (restart-front-desk-group! project-root))
   :handoffd (fn [project-root _main-sha] (restart-handoffd-group! project-root))
   :operator restart-operator-group!})

(defn- run-sync! [project-root]
  (let [processes (gather-processes project-root)
        main-sha (main-sha! project-root)
        report (build-freshness-lib/freshness-report processes main-sha)
        stale-names (set (build-freshness-lib/stale-process-names report))
        stale-groups (->> processes (filter #(contains? stale-names (:name %))) (map :group) distinct)
        ;; BL-335: extension/out/ is a SINGLE shared compiled directory, and
        ;; it is not just the :front-desk group (bridge/bot) that depends on
        ;; it - handoffd shells out to several of its own
        ;; extension/out/tools/*.js CLIs (render-briefing-diagrams.js,
        ;; suite-duration-line.js, emit-cost-health-sidecar.js, ...) and
        ;; operator_runtime.bb shells to operator-decide.js, so a
        ;; :handoffd- or :operator-only staleness can equally mean a
        ;; Node-shelled tool is stale. Scoping the recompile decision to
        ;; :front-desk alone (the original BL-328 shape) left exactly this
        ;; gap: restart-handoffd-group!/restart-operator-group! only
        ;; restart the BABASHKA process, never recompile, so a stale
        ;; compiled CLI stayed stale forever behind a "successful" sync.
        ;; Any staleness at all now triggers the one recompile - cheap when
        ;; unnecessary, and the only way to never silently miss a case.
        node-stale? (seq stale-names)]
    (when node-stale?
      (recompile-extension! project-root))
    (doseq [group stale-groups]
      ((get restart-group! group) project-root main-sha))
    ;; BL-433: a restarted operator group has ALREADY settled by this point
    ;; (restart-operator-group! blocked on it, or threw) - re-gathering here
    ;; (rather than returning the pre-restart `report` snapshot above) is
    ;; what makes the returned report reflect reality post-restart, so a
    ;; second sync/report pass is never needed to see it fresh.
    (let [settled-processes (gather-processes project-root)
          settled-report (build-freshness-lib/freshness-report settled-processes main-sha)]
      {:report settled-report :restarted (mapv name stale-groups)})))

(defn -main [& args]
  (let [[project-root subcommand] args]
    (when (or (str/blank? project-root) (not (#{"report" "sync"} subcommand)))
      (usage))
    (try
      (let [result (case subcommand
                     "report" (run-report! project-root)
                     "sync" (run-sync! project-root))]
        (println (json/generate-string result))
        (System/exit 0))
      (catch Exception e
        (binding [*out* *err*] (println (str "error: " (.getMessage e))))
        (System/exit 2)))))

(apply -main *command-line-args*)
