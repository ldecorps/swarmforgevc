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
;;     Prints {"processes":[{"name":...,"running_sha":...,"main_sha":...,
;;     "stale":true|false}, ...], "qa_approval":{"approved":true|false,
;;     "offending_shas":[...],"qa_ref_missing":true|false}}. The qa_approval
;;     block is BL-629: is main's tip on the swarmforge-QA integration
;;     ancestry, distinct from per-process staleness. Exit 0 always - an
;;     unresolvable identity just reads as not-stale, never fabricate.
;;   build_freshness_cli.bb <project-root> sync [--override]
;;     BL-629 gate FIRST: refuses (exit 3, see refusal-exit-code below) when
;;     the tip sync would deploy - drift on main since the last QA-landed
;;     commit (git merge-base main swarmforge-QA), OR an uncommitted
;;     modification under the deployed code surface - is not QA-approved,
;;     or when the swarmforge-QA ref itself is missing (fails closed). On
;;     refusal, NOTHING else runs: no recompile, no restart. --override
;;     proceeds anyway and leaves a durable, one-shot record (never sticky)
;;     under .swarmforge/build-freshness/sync-overrides.jsonl.
;;     Once the gate lets it through: recompiles extension/ (once, if any
;;     Node-backed process is stale), then restarts every stale process's
;;     own GROUP via its existing mechanism. Prints {"report":[...],
;;     "restarted":[...]}. Exit 0 on success, exit 2 if a restart step
;;     failed, exit 3 on gate refusal.

(ns build-freshness-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/path (fs/parent (fs/canonicalize *file*)))))

(load-file (str (fs/path script-dir "build_freshness_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: build_freshness_cli.bb <project-root> report | sync [--override]"))
  (System/exit 2))

;; BL-629: the sync refusal exit status - distinct from 0 (success) and 2
;; (usage/operational failure) so callers can tell "gate refused" from
;; "restart broke".
(def refusal-exit-code 3)

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

;; ── BL-629: gathered facts for the QA-approval gate (report and sync both
;;    consult these - no git/fs lives in build_freshness_lib.bb itself) ────

(defn- qa-ref-sha! [project-root]
  (let [{:keys [exit out]} (process/sh {:continue true :dir project-root} "git" "rev-parse" "--verify" "swarmforge-QA")]
    (when (zero? exit) (str/trim out))))

(defn- merge-base! [project-root a b]
  (let [{:keys [exit out]} (process/sh {:continue true :dir project-root} "git" "merge-base" a b)]
    (when (zero? exit) (str/trim out))))

;; BL-629 architect bounce #1 finding 4: {:ok? :shas} instead of a bare list -
;; a git failure must be distinguishable from "no commits", or the caller
;; cannot tell "no drift" from "could not tell" and silently reads unknown
;; as approved (the exact fail-open bug the finding reproduced).
(defn- commit-shas-since! [project-root base tip]
  (let [{:keys [exit out]} (process/sh {:continue true :dir project-root} "git" "log" "--format=%H" (str base ".." tip))]
    (if (zero? exit)
      {:ok? true :shas (remove str/blank? (str/split-lines out))}
      {:ok? false :shas []})))

;; -c (combined diff): for a merge commit, report only the paths whose
;; content in the merge result differs from EVERY parent - i.e. the merge's
;; own resolution, not everything either side already changed. A routine
;; `--no-ff` QA-landing merge resolves cleanly to one side and reports
;; nothing; an evil merge that resolves a conflict (or otherwise introduces
;; content neither parent had) still reports those paths. -m (diff against
;; each parent, union the results) was tried first and rejected: it flags
;; the routine post-QA landing merge itself as offending drift because that
;; merge legitimately differs from main's PRIOR tip, which would make sync
;; refuse every single day (BL-629 architect bounce #1, finding 2) - the
;; exact daily-friction failure mode the spec forbids. -c still catches a
;; real evil merge (BL-590's own f8dc07963: its content commit 73706d79e is
;; still named) while staying silent on QA's own clean landings
;; (4e9cd883d, f0be69ac8). Single-parent commits are unaffected by either
;; flag.
;; BL-629 architect bounce #1 finding 4: {:ok? :paths}, same reasoning as
;; commit-shas-since! above - a git failure on ONE commit must not silently
;; read as "this commit touches nothing" (bookkeeping-only), which is what
;; an empty path list means to touches-deployed-surface?.
(defn- changed-paths-for-commit! [project-root sha]
  (let [{:keys [exit out]} (process/sh {:continue true :dir project-root}
                                        "git" "diff-tree" "--no-commit-id" "--name-only" "-r" "-c" sha)]
    (if (zero? exit)
      {:ok? true :paths (vec (distinct (remove str/blank? (str/split-lines out))))}
      {:ok? false :paths []})))

;; BL-629 architect bounce #1 finding 4: every gatherer below can fail open
;; today - a merge-base miss (no common ancestor - reproduced live: two
;; valid refs, no shared history), a `git log` failure, or a `git diff-tree`
;; failure per commit all degrade to an empty result, which every consumer
;; reads as "no drift" = approved. :facts-complete? false is the explicit
;; "could not determine" state the spec's fail-closed posture (item 4) needs
;; but never had - sync-gate-decision refuses on it exactly like a missing
;; ref. An unresolvable commit's own touches-surface? is presumed TRUE (the
;; conservative default for THAT one commit), independently of the overall
;; facts-complete? flag - it still counts as an offending sha if the drift
;; is otherwise approved, so it is not lost even when override is used.
(defn- drift-facts! [project-root]
  (if-let [qa-sha (qa-ref-sha! project-root)]
    (let [base (merge-base! project-root "main" "swarmforge-QA")]
      (if-not base
        {:qa-ref-exists? true :drift-commits [] :facts-complete? false}
        (let [{shas-ok? :ok? shas :shas} (commit-shas-since! project-root base "main")]
          (if-not shas-ok?
            {:qa-ref-exists? true :drift-commits [] :facts-complete? false}
            (let [drift-commits (mapv (fn [sha]
                                         (let [{paths-ok? :ok? paths :paths} (changed-paths-for-commit! project-root sha)]
                                           {:sha sha
                                            :touches-surface? (if paths-ok?
                                                                 (build-freshness-lib/touches-deployed-surface? paths)
                                                                 true)
                                            :ok? paths-ok?}))
                                       shas)]
              {:qa-ref-exists? true
               :drift-commits drift-commits
               :facts-complete? (every? :ok? drift-commits)})))))
    {:qa-ref-exists? false :drift-commits [] :facts-complete? true}))

;; git status --porcelain: first 2 chars are the XY status codes, then a
;; space, then the path (renames read "old -> new" - the new path is what
;; matters for "does this land under the surface").
(defn- porcelain-path [line]
  (let [raw (subs line (min 3 (count line)))
        arrow (str/index-of raw " -> ")]
    (str/trim (if arrow (subs raw (+ arrow 4)) raw))))

;; BL-629 architect bounce #1 finding 4: {:ok? :paths} - a `git status`
;; failure must not silently read as "working tree is clean".
(defn- dirty-surface-paths! [project-root]
  (let [{:keys [exit out]} (process/sh {:continue true :dir project-root} "git" "status" "--porcelain")]
    (if (zero? exit)
      {:ok? true
       :paths (->> (str/split-lines out)
                   (remove str/blank?)
                   (map porcelain-path)
                   (filter build-freshness-lib/on-deployed-surface?)
                   distinct
                   vec)}
      {:ok? false :paths []})))

(defn- override-log-path [project-root]
  (fs/path project-root ".swarmforge" "build-freshness" "sync-overrides.jsonl"))

(defn- now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))

;; Durable, append-only, one line per override - "never sticky" (BL-629
;; scenario 05) means the CLI never READS this file to decide anything; it
;; exists purely as the audit trail spec resolution item 4 requires.
(defn- append-override-record! [project-root gate]
  (let [f (override-log-path project-root)]
    (fs/create-dirs (fs/parent f))
    (spit (str f)
          (str (json/generate-string {:at (now-iso)
                                       :reason (some-> (:reason gate) name)
                                       :offending_shas (:offending-shas gate)
                                       :offending_paths (:offending-paths gate)})
                "\n")
          :append true)))

(defn- refusal-message [gate]
  (let [remedy "remedy: land the change through QA, or rerun with --override (logged, one-shot)"]
    (case (:reason gate)
      :missing-ref
      (str "build_freshness_cli.bb sync: REFUSED - the QA approval reference (swarmforge-QA) is missing\n  " remedy)
      :gather-failed
      (str "build_freshness_cli.bb sync: REFUSED - could not determine whether main is QA-approved (a git command failed while gathering drift facts)\n  " remedy)
      :code-drift
      (str "build_freshness_cli.bb sync: REFUSED - main is not QA-approved\n"
           "  offending commit(s): " (str/join " " (:offending-shas gate)) "\n  " remedy)
      :dirty-surface
      (str "build_freshness_cli.bb sync: REFUSED - uncommitted changes under the deployed code surface\n"
           "  modified path(s): " (str/join " " (:offending-paths gate)) "\n  " remedy))))

(defn- run-report! [project-root]
  (let [processes (gather-processes project-root)
        main-sha (main-sha! project-root)
        report (build-freshness-lib/freshness-report processes main-sha)
        {:keys [qa-ref-exists? drift-commits facts-complete?]} (drift-facts! project-root)
        tip-approval (if qa-ref-exists?
                       (build-freshness-lib/tip-approval-status drift-commits facts-complete?)
                       {:approved? false :offending-shas []})]
    {:processes report
     :qa_approval {:approved (:approved? tip-approval)
                   :offending_shas (:offending-shas tip-approval)
                   :qa_ref_missing (not qa-ref-exists?)}}))

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

;; BL-629: gate-checked-first now - build-freshness-lib/execute-sync! is the
;; single dispatch point (pure decision, adapter-injected side effects); the
;; recompile-once/restart-per-group logic below is unchanged from BL-335,
;; just moved behind the gate as adapters instead of running inline.
(defn- run-sync! [project-root override?]
  (let [{:keys [qa-ref-exists? drift-commits facts-complete?]} (drift-facts! project-root)
        {dirty-ok? :ok? dirty-surface-paths :paths} (dirty-surface-paths! project-root)
        processes (gather-processes project-root)
        main-sha (main-sha! project-root)
        facts {:qa-ref-exists? qa-ref-exists?
               :drift-commits drift-commits
               :dirty-surface-paths dirty-surface-paths
               :facts-complete? (and facts-complete? dirty-ok?)
               :override? override?
               :processes processes
               :main-sha main-sha}
        adapters {:recompile! (fn [] (recompile-extension! project-root))
                  :restart-group! (fn [group] ((get restart-group! group) project-root main-sha))
                  :record-override! (fn [gate] (append-override-record! project-root gate))
                  ;; BL-433: a restarted operator group has ALREADY settled by
                  ;; this point - re-gathering here is what makes the returned
                  ;; report reflect reality post-restart, so a second
                  ;; sync/report pass is never needed to see it fresh.
                  :gather-settled-report (fn []
                                           (build-freshness-lib/freshness-report
                                            (gather-processes project-root) main-sha))}]
    (build-freshness-lib/execute-sync! facts adapters)))

(defn -main [& args]
  (let [[project-root subcommand & rest-args] args
        override? (boolean (some #{"--override"} rest-args))]
    (when (or (str/blank? project-root) (not (#{"report" "sync"} subcommand)))
      (usage))
    (try
      (case subcommand
        "report" (do (println (json/generate-string (run-report! project-root)))
                     (System/exit 0))
        "sync" (let [{:keys [refused gate report restarted]} (run-sync! project-root override?)]
                 (if refused
                   (do (binding [*out* *err*] (println (refusal-message gate)))
                       (System/exit refusal-exit-code))
                   (do (println (json/generate-string {:report report :restarted restarted}))
                       (System/exit 0)))))
      (catch Exception e
        (binding [*out* *err*] (println (str "error: " (.getMessage e))))
        (System/exit 2)))))

(apply -main *command-line-args*)
