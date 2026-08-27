#!/usr/bin/env bb

;; Every subprocess call goes through daemon-cycle-guard-lib/sh! (BL-967's
;; bounded chokepoint over babashka.process), NEVER clojure.java.shell: bb's
;; clojure.java.shell shim can deadlock reading subprocess streams (observed
;; hanging notify! mid-delivery and silently stalling the whole swarm, BL-061).
;; This ns deliberately does not require babashka.process itself - the
;; guard-lib closure gate in daemon_cycle_guard_lib_test_runner.bb fails on
;; any direct subprocess path outside the chokepoint.
(ns handoffd
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.java.io :as io]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "shell_quote_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "node_tool_bringup_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "ambulance_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "chase_sweep_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "mono_router_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "agent_runtime_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "agent_runtime_inject.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_alarm_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "briefing_email_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "briefing_generation_schedule_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "banked_briefing_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "operator_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "llm_cost_ledger_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "closing_context_clear_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "standing_rule_violations_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "control_plane_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "standing_rule_violations_files.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "stuck_escalation_email_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "loop_detect_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "push_sweep_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "push_sweep_ahead_range_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "master_main_reconcile_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "post_qa_branch_sweep_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "flow_watchdog_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "master_checkout_drift_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "master_checkout_integrity_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "provider_compat_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "provider_respawn_env_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "provider_auth_observe_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "provider_outage_evidence_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "outage_failover_cli.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "wake_attribution_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "task_commit_coherence_gate_lib.bb")))

(def poll-ms 1000)
(def wake-message agent-runtime-lib/default-wake-chat-message)

;; BL-146: single-daemon consolidation. Chase/nudge sweeps run every
;; chase-sweep-every-cycles poll cycles (poll-ms apart) - the same babashka
;; process that already owns delivery now also owns liveness, so the
;; extension host becomes a pure observer instead of running its own
;; setInterval sweep.
;; Chase + BL-528 claim-progress sweeps run every N handoffd poll cycles (1s each).
(def chase-sweep-every-cycles 10)
(def chase-sweep-config
  {:chaseIntervalSeconds 5
   :chaseTimeoutSeconds 30
   :maxChases 3
   :stuckInProcessTimeoutSeconds 60
   :respawnCooldownSeconds 300
   :chaseBackoffBaseSeconds 30
   :chaseBackoffMaxSeconds 300
   ;; BL-528: claim-without-progress (git HEAD unchanged since claim).
   :claim-idle-timeout-ms (* 20 60 1000)
   :nudge-threshold 1
   :bounce-threshold 6
   :halt-threshold 10})

;; Pane churn within this window suppresses BL-528 idle reclaims (shell runs,
;; mutation passes, explore subagents — no esc-to-interrupt footer required).
(def claim-recent-activity-ms (* 5 60 1000))

;; Mono-router: defer chase wakes when the resident pane changed recently even
;; if the busy footer is momentarily absent between spinner refreshes.
(def chase-resident-recent-activity-ms 15000)

;; Endless NO_TASK-spin circuit breaker: pane activity hashing alone cannot
;; see a busy-loop that keeps changing the pane with the same idle ritual.
;; Per-role strike state lives in this process only; a daemon restart that
;; loses strikes is safe (the spin re-arms within two chase observations).
(def loop-detect-states (atom {}))
(def loop-halt-triggered? (atom false))

;; BL-536: per-role auth-class failure episode state (provider_auth_observe_
;; lib.bb's {:attempts :alerted} shape). Same in-memory-atom rationale as
;; loop-detect-states above - a daemon restart losing an in-flight episode's
;; attempt count is safe; the next auth-class observation just starts a
;; fresh episode.
(def auth-observe-states (atom {}))

;; BL-798: open-slot promotion-inaction escalation state (chase_sweep_lib's
;; own {:candidate-id :count :escalated} shape). Same in-memory-atom
;; rationale as loop-detect-states/auth-observe-states above — a daemon
;; restart losing the unacted-nudge count is safe, the next sweep tick just
;; resumes counting from 0 for whichever candidate is still top.
(def open-slot-escalation-state (atom nil))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: handoffd.bb <project-root>"))
  (System/exit 1))

(def project-root
  (or (first *command-line-args*) (usage)))

;; BL-812: handoffd's process cwd is not guaranteed to be project-root (seen
;; live: launcher home dir) - without this, every handoff-lib target-root
;; read (roles.tsv, tmux-socket, launch scripts, mono-router-active-role)
;; silently resolved against the WRONG root via git-common-dir-from-cwd, so
;; wake remap and resident rotation missed the real .swarmforge/ and chase
;; degraded to injecting into sessions mono-router never creates. Set once,
;; before any handoff-lib call below reads target-root.
(handoff-lib/set-project-root! project-root)

;; BL-897: the deterministic, machine-local (never committed - already
;; covered by the bare .swarmforge/ .gitignore entry) path every briefing-
;; section CLI is handed via --snapshot, so all three read the SAME
;; already-derived lifecycle records instead of each re-walking the
;; backlog's full git history (extension/src/metrics/lifecycleSnapshot.ts's
;; lifecycleSnapshotPath, same join, kept in sync by hand since Babashka
;; cannot import the compiled TS module). Defined here, right after
;; project-root, so every shell-out below (regardless of its own position
;; in the file) can reference it.
(def lifecycle-snapshot-path
  (str (fs/path project-root ".swarmforge" "briefing" "lifecycle-snapshot.json")))

;; BL-406: refuse to run at all against a throwaway test/temp project root
;; unless the caller explicitly opts in - checked here, before this daemon
;; claims a pid file, loads roles, or starts a single sweep, so a leaked
;; test daemon can never come alive to leak in the first place (root cause:
;; six /tmp acceptance-sandbox daemons orphaned by a killed test, alive
;; 9-11h, each independently sweeping and sending real briefing email -
;; test-fixture-root?'s send-path suppression in daemon_alarm_lib.bb is a
;; second, narrower layer, not a substitute for this one). Every wiring
;; test that intentionally runs a real daemon under a temp root sets this
;; env var; a leaked/mistaken invocation without it exits immediately
;; instead of running unsupervised for hours.
(def allow-tmp-daemon-env-var "SWARMFORGE_ALLOW_TMP_DAEMON")

(defn refuse-tmp-root! [root]
  (binding [*out* *err*]
    (println (str "handoffd.bb: refusing to start against a throwaway test/temp project root (" root ") "
                   "without " allow-tmp-daemon-env-var "=1 set (BL-406). If this is an intentional "
                   "test fixture, export " allow-tmp-daemon-env-var "=1 before starting the daemon.")))
  (System/exit 1))

(when (daemon-alarm-lib/refuse-tmp-daemon-start? project-root (System/getenv allow-tmp-daemon-env-var))
  (refuse-tmp-root! project-root))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def state-dir (fs/path project-root ".swarmforge"))
(def daemon-dir (fs/path state-dir "daemon"))
(def roles-file (fs/path state-dir "roles.tsv"))
(def socket-file (fs/path state-dir "tmux-socket"))
;; BL-214: same conf handoffd_supervisor.bb's BL-144 alarm already reads -
;; notify_email_to/notify_email_from live here, RESEND_API_KEY in the
;; daemon's own process env, same as that alarm path.
(def conf-file (fs/path script-dir ".." "swarmforge.conf"))
(def briefings-dir (fs/path project-root "docs" "briefings"))
;; BL-308: read-only reuse of BL-307's hibernation-state signal (READ ONLY -
;; this ticket does not touch operator_runtime.bb, which owns writing it).
;; Same path/shape operator_runtime.bb's write-hibernation-state! produces:
;; {"hibernated": true, "hibernated_at_ms": ..., "config_path": ...}.
(def hibernation-state-file (fs/path state-dir "operator" "hibernation.json"))
(def backlog-active-dir (fs/path project-root "backlog" "active"))
(def backlog-paused-dir (fs/path project-root "backlog" "paused"))
(def backlog-done-dir (fs/path project-root "backlog" "done"))
;; BL-309: durable "which bookkeeping close was last cleared for" marker -
;; same small-JSON-under-.swarmforge/ posture as operator_runtime.bb's own
;; hibernation-state-file, so a daemon restart never replays a clear for a
;; close already handled.
(def context-clear-marker-file (fs/path state-dir "coordinator-context-clear.json"))
;; BL-316: the generalized per-role counterpart - one JSON map keyed by
;; role-name -> last-cleared inbox/completed/ entry id, so a daemon restart
;; never replays a clear for any non-coordinator role's completion already
;; handled. Deliberately a SEPARATE file from context-clear-marker-file
;; above: the coordinator keeps its own dedicated mechanism/marker
;; untouched, and this file must never gain a "coordinator" key.
(def role-context-clear-marker-file (fs/path state-dir "role-context-clear.json"))
(def pid-file (fs/path daemon-dir "handoffd.pid"))
(def pid-lock-dir (fs/path daemon-dir "pid.lock"))
(def stop-file (fs/path daemon-dir "stop"))
(def log-file (fs/path daemon-dir "handoffd.log"))
(def heartbeat-file (fs/path daemon-dir "handoffd.heartbeat"))
;; BL-675: log a heartbeat every loop tick so quiet != dead for the
;; cron-side freshness checker (was every 60 cycles; that left long
;; silent windows that looked identical to a futex hang).
(def heartbeat-log-every-cycles 1)
(def heartbeat-dir (fs/path state-dir "heartbeat"))
;; A dedicated file, deliberately NOT handoffd.status.json: that file is
;; exclusively owned by handoffd_supervisor.bb, which runs CONCURRENTLY
;; with this process against the same project root (swarmforge.sh launches
;; both). Two processes read-modify-writing the same JSON file with no
;; locking on either side is a lost-update race - whichever writes last
;; would silently clobber the other's fields (BL-146 integration failure).
(def duties-file (fs/path daemon-dir "handoffd-duties.json"))
(def stopping? (atom false))
(def main-thread (atom nil))

(defn now []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT)
           (java.time.Instant/now)))

(defn log! [& parts]
  (fs/create-dirs daemon-dir)
  (spit (str log-file)
        (str (now) " " (str/join " " parts) "\n")
        :append true))

;; BL-967 invariant 1: a bounded-wait hit anywhere in the cycle is logged
;; and survived, attributed to the sweep that was running. Wired once here;
;; daemon-cycle-guard-lib/sh! is the chokepoint every subprocess call in
;; this file (and handoff_lib.bb's own calls) now runs through.
(reset! daemon-cycle-guard-lib/on-timeout!
        (fn [{:keys [context cmd bound-ms]}]
          (log! "subprocess-timeout"
                (str "sweep=" context " bound-ms=" bound-ms
                     " cmd=" (str/join " " (take 4 cmd))))))

;; BL-977: publish the in-flight sweep marker so the supervisor can tell a
;; heavy-but-progressing cycle (dropped-parcel-sweep measured 143269 ms on
;; 2026-08-20) from true silence. Written by run-sweep!'s own transitions -
;; the marker advances only with real poll-loop progress.
(daemon-cycle-guard-lib/install-sweep-marker-writer!
 (str (fs/path daemon-dir "handoffd.sweep-marker")))

;; BL-967 invariant 2: one boundary line per heavy-bundle sweep, action or
;; no action, so the log alone localizes any stall to one sweep.
(defn run-sweep! [sweep-name thunk]
  (daemon-cycle-guard-lib/run-sweep!
   log! (fn [] (System/currentTimeMillis)) sweep-name thunk))

(defn read-lines [path]
  (when (fs/exists? path)
    (str/split-lines (slurp (str path)))))

(defn load-roles []
  (into {}
        (for [line (read-lines roles-file)
              :when (not (str/blank? line))
              :let [[role worktree-name worktree-path session display agent receive-mode]
                    (str/split line #"\t")]]
          [role {:role role
                 :worktree-name worktree-name
                 :worktree-path worktree-path
                 :session session
                 :display display
                 :agent agent
                 :receive-mode (or receive-mode "task")}])))

(defn parse-message [path]
  (let [content (slurp (str path))]
    (assoc (handoff-lib/parse-envelope content) :content content)))

(defn render-message [headers body]
  (let [preferred ["id" "from" "to" "recipient" "priority" "type" "role" "commit"
                   "message" "created_at" "enqueued_at" "dequeued_at" "completed_at"]
        remaining (->> (keys headers)
                       (remove (set preferred))
                       sort)
        ordered (concat preferred remaining)]
    (str (str/join "\n"
                   (for [k ordered
                         :let [v (get headers k)]
                         :when v]
                     (str k ": " v)))
         "\n\n"
         body)))

(defn add-delivery-headers [message recipient]
  (-> message
      (assoc-in [:headers "recipient"] recipient)
      (assoc-in [:headers "enqueued_at"] (now))))

(defn rule-proposals-file []
  (fs/path state-dir "rule_proposals"
           (str (.format (java.time.format.DateTimeFormatter/ofPattern "yyyy-MM")
                         (.atZone (java.time.Instant/now) java.time.ZoneOffset/UTC))
                ".jsonl")))

;; Durable audit trail for BL-035 rule_proposal handoffs: one line per
;; delivered proposal, appended at delivery time (not the eventual
;; accept/reject outcome — the specifier's review is prompt/agent behavior,
;; not scriptable code here). Uses cheshire (already a project dependency
;; for this identical jsonl-audit-log pattern in salvage_lib.bb's
;; log-event!) rather than hand-rolled escaping, which only escaped
;; backslash/quote/newline and produced invalid JSON for any other control
;; character (e.g. a literal tab) in a proposal's body or rationale.
(defn append-rule-proposal! [headers]
  (let [file (rule-proposals-file)
        line (json/generate-string {:scope (get headers "scope")
                                     :body (get headers "body")
                                     :rationale (get headers "rationale")
                                     :proposer (get headers "from")
                                     :timestamp (now)})]
    (fs/create-dirs (fs/parent file))
    (spit (str file) (str line "\n") :append true)))

(defn delivered-filename
  "Per-recipient copy name. Recipients that share an inbox directory (e.g.
   coordinator and specifier on master) would otherwise collide on the original
   outbox filename and clobber each other's copy (BL-057). The recipient is
   appended just before the extension so the leading
   <priority>_<timestamp>_<sequence> sort order is untouched."
  [filename recipient]
  (str/replace filename #"\.handoff$" (str "_for_" recipient ".handoff")))

(defn target-path [role-info filename recipient]
  (fs/path (handoff-lib/mailbox-dir role-info :new)
           (delivered-filename filename recipient)))

(defn tmux! [& args]
  ;; BL-967: bounded at the chokepoint - a wedged tmux server costs one
  ;; bounded wait, never the heartbeat.
  (apply daemon-cycle-guard-lib/sh! "tmux" args))

;; BL-093: send-keys was fire-and-forget - a lost Enter left the wake message
;; typed-but-unsubmitted, and repeated notify! calls (chaser respawns, retried
;; deliveries) stacked further unconsumed copies in the same pane. The
;; heuristic mirrors extension/src/swarm/verifiedInject.ts: the pane's input
;; line is whatever trails the last recognizable prompt marker ($/#/❯/>) on
;; the last non-blank captured line; a marker with nothing after it is an
;; empty (not pending) prompt.
;;
;; BL-109: a line with NO recognizable marker at all is standing UI chrome,
;; not pending input - e.g. Claude Code's idle status footer ("  ⏵⏵ bypass
;; permissions on (shift+tab to cycle)  /rc"), which contains none of
;; `$#❯>` and rendered as the pane's last non-blank line while genuinely
;; idle. The previous "no marker -> treat the whole line as pending"
;; fallback read that footer as forever-pending text, so notify! took the
;; "recover pending text" branch and never typed the real wake-up message at
;; all - a deterministic failure specifically when the target was IDLE.
(def notify-max-retries 3)
(def notify-retry-delay-ms 200)

(defn capture-pane-text [socket session]
  (:out (tmux! "-S" socket "capture-pane" "-p" "-t" session)))

;; BL-927: resident-live-role relocated to handoff-lib (handoffd.bb already
;; load-files handoff_lib.bb, so the reverse would be circular) - it is the
;; single definition, reused by both the chase call sites below and
;; departing-role-blocking-handoff's resident-invoked rotation gate. Do not
;; redefine it here.

(defn last-non-blank-line [pane-text]
  (last (remove str/blank? (str/split-lines (or pane-text "")))))

(defn pending-input-line [pane-text]
  (let [line (last-non-blank-line pane-text)]
    (if (nil? line)
      ""
      (if-let [[_ tail] (re-find #"[$#❯>]\s*(\S.*)?$" line)]
        (str/trim (or tail ""))
        ""))))

(defn pending-input? [pane-text]
  (not (str/blank? (pending-input-line pane-text))))

(defn text-still-pending? [pane-text text]
  (let [pending (pending-input-line pane-text)]
    (and (not (str/blank? pending)) (str/includes? pending (str/trim text)))))

(defn send-submit!
  "Sends the C-m/C-j submit sequence. Returns true when both tmux
   invocations themselves succeeded (transport-level) - false means the
   pane/session/socket is gone, which the retry loop must not paper over by
   quietly re-capturing and backing off."
  [socket session]
  (let [cr (tmux! "-S" socket "send-keys" "-t" session "C-m")]
    (Thread/sleep 50)
    (let [lf (tmux! "-S" socket "send-keys" "-t" session "C-j")]
      (and (zero? (:exit cr)) (zero? (:exit lf))))))

(defn tmux-inject-disabled? []
  (or (= "1" (System/getenv "SWARMFORGE_MAILBOX_ONLY"))
      (= "1" (System/getenv "SWARMFORGE_SKIP_TMUX_INJECT"))))

(defn notify!
  [socket session agent]
  (let [session (handoff-lib/wake-session socket session)]
    (agent-runtime-inject/notify-agent! socket session (or agent "claude")
                                          :log-fn (fn [tag sess detail] (log! tag sess detail))
                                          :script-rel-path agent-runtime-lib/ready-script-rel-path)))

(defn notify-in-process-resume!
  "Stuck nudge for work already sitting in in_process — chat order, never
   another ready_for_next shell wake (that reprints the same TASK)."
  [socket session agent]
  (let [session (handoff-lib/wake-session socket session)
        text (:text (first (agent-runtime-lib/in-process-resume-steps (or agent "claude"))))]
    (agent-runtime-inject/notify-agent! socket session (or agent "claude")
                                          :log-fn (fn [tag sess detail] (log! tag sess detail))
                                          :text text)))

(defn recipient-pane-busy?
  "BL-135 parity on the delivery path: mail lands in inbox/new either way;
   do not inject wake spam while the recipient is mid-turn. Under mono-router
   the configured session may be dormant — always capture the wake target pane
   (same session notify! will inject into)."
  [socket roles role]
  (when-let [ri (get roles role)]
    (let [session (handoff-lib/wake-session socket (:session ri))
          pane (try (capture-pane-text socket session) (catch Exception _ ""))]
      (chase-sweep-lib/actively-processing? pane))))

(defn chase-poke-action
  "Decide how to poke `role` under mono-router (pure wrapper around
   mono-router-lib/dormant-mailbox-chase-action with live tmux probes).
   BL-921: also probes the resident pane's own live identity so a diverged
   active-role marker can no longer produce a false :wake-resident."
  [roles socket role]
  (let [session (:session (get roles role))
        resident (handoff-lib/mono-router-resident-session)]
    (mono-router-lib/dormant-mailbox-chase-action
     {:target-session-exists? (boolean (and session (handoff-lib/session-exists? socket session)))
      :resident-session-exists? (boolean (and resident (handoff-lib/session-exists? socket resident)))
      :active-role (handoff-lib/read-mono-router-active-role)
      :target-role role
      :live-role (handoff-lib/resident-live-role socket resident)})))

(defn maybe-notify!
  "Tmux wake after mailbox delivery. Skipped when SWARMFORGE_MAILBOX_ONLY=1,
   the inbox file already existed (duplicate delivery), the recipient pane
   is actively working a turn (BL-135 / mono-router resident mid-task), this
   parcel already woke the same tmux session for another recipient
   (broadcast merge-up notes), or (BL-576) the parcel is a note landing in a
   dormant mailbox while the resident is live as a DIFFERENT role — the
   aged-note chase now guarantees eventual pickup, so the wake that would
   only re-run ready_for_next as the wrong identity and NO_TASK is skipped."
  [socket roles session role recipient-path agent & {:keys [new-delivery? notified-sessions parcel-type]
                                                     :or {new-delivery? true
                                                          notified-sessions (atom #{})}}]
  (let [wake-sess (handoff-lib/wake-session socket session)]
    (cond
      (not new-delivery?)
      (log! "deliver-notify-skip-duplicate" role (str recipient-path))

      (tmux-inject-disabled?)
      (log! "delivered-mailbox-only" role (str recipient-path))

      (contains? @notified-sessions wake-sess)
      (log! "deliver-notify-skip-dedup" role wake-sess)

      (and (= "note" parcel-type)
           (mono-router-lib/suppress-dormant-note-delivery-wake?
            {:parcel-type parcel-type
             :chase-action (chase-poke-action roles socket role)}))
      (log! "deliver-notify-skip-dormant-note" role (str recipient-path))

      (recipient-pane-busy? socket roles role)
      (log! "deliver-notify-skip-busy" role (str recipient-path))

      :else
      (do (swap! notified-sessions conj wake-sess)
          (notify! socket session agent)))))

(defn move-with-collision
  "Moves source into target-dir, uniquifying on a name collision. Returns
   the path source was actually moved to, so callers can act on the final
   location (BL-083: a .error stub must sit next to wherever the file
   actually landed, not next to a path that may no longer exist)."
  [source target-dir]
  (fs/create-dirs target-dir)
  (let [base (fs/file-name source)
        target (fs/path target-dir base)]
    (if (fs/exists? target)
      (let [uniq (fs/path target-dir (str (now) "_" base))]
        (fs/move source uniq {:replace-existing false})
        uniq)
      (do
        (fs/move source target {:replace-existing false})
        target))))

(defn sent-dir [role-info]
  (handoff-lib/mailbox-dir role-info :sent))

(defn already-archived?
  "True when a file of this name already sits in the sender's sent/ dir -
   meaning some delivery attempt (this daemon or a duplicate/prior one)
   already completed the archive, so a failure processing THIS attempt is
   not a real error (BL-083: duplicate handoffd daemons, or a crash-restart
   retry, can both reach the same already-archived outbox file)."
  [role-info filename]
  (fs/exists? (fs/path (sent-dir role-info) filename)))

(defn fail! [path reason]
  (let [failed-dir (fs/path (fs/parent (fs/parent path)) "failed")]
    (log! "failed" (str path) reason)
    (try
      (let [moved (move-with-collision path failed-dir)]
        (spit (str moved ".error") (str reason "\n")))
      (catch Exception move-ex
        ;; The rename itself failed (path is still in outbox): the stub has
        ;; to live next to the file where it actually is.
        (log! "failed-to-archive" (str path) (.getMessage move-ex))
        (spit (str path ".error") (str reason "\n"))))))


(defn deliver! [roles socket sender-role path]
  (let [filename (fs/file-name path)]
    ;; BL-365: a corrupt outbox file (empty, truncated mid-header, or
    ;; headers with no body) must be quarantined here, at the delivery hop,
    ;; rather than copied onward into a recipient's inbox as if it were real
    ;; work - the protocol already asks the daemon for exactly this cheap
    ;; structural check ("move malformed or undeliverable files to failed/
    ;; with useful diagnostics"), distinct from the semantic re-validation
    ;; the daemon deliberately declines.
    (if (handoff-lib/corrupt-handoff? (slurp (str path)))
      (fail! path "corrupt handoff (empty, truncated, or missing required envelope headers)")
      (let [message (parse-message path)
            headers (:headers message)
            recipients (some-> (get headers "to") (str/split #",") seq)]
        (if-not recipients
          (fail! path "missing to header")
          (let [notified-sessions (atom #{})]
            (do
              (doseq [recipient recipients]
              (let [role-info (get roles recipient)]
                (when-not role-info
                  (throw (ex-info (str "unknown recipient " recipient) {:recipient recipient})))
                (let [target (target-path role-info filename recipient)
                      delivered (add-delivery-headers message recipient)
                      new-delivery? (not (fs/exists? target))]
                  (fs/create-dirs (fs/parent target))
                  (when new-delivery?
                    ;; BL-365: durable write - the recipient's inbox copy is
                    ;; a SEPARATE file from the sender's own outbox/sent
                    ;; copy, and carries the identical crash-durability gap
                    ;; if written with a bare spit.
                    (handoff-lib/atomic-write! target (render-message (:headers delivered) (:body delivered))))
                  ;; BL-551 writer-handoff-02: stamp an llm_invocation
                  ;; correlation record BEFORE the recipient is woken -
                  ;; try/catch'd so a telemetry write failure never blocks
                  ;; the real delivery/wake below it.
                  (try
                    (let [usage (llm-cost-ledger-lib/latest-role-usage-from-context-events
                                 (str state-dir) recipient)]
                      (llm-cost-ledger-lib/append-llm-invocation-record!
                       (str state-dir)
                       (operator-lib/handoff-delivery-llm-invocation-record
                        {:recipient recipient :headers headers :usage usage}
                        (now))))
                    (catch Exception e
                      (log! "llm-cost-ledger-append-error" recipient (.getMessage e))))
                  (maybe-notify! socket roles (:session role-info) recipient (str target)
                                 (:agent role-info) :new-delivery? new-delivery?
                                 :notified-sessions notified-sessions
                                 :parcel-type (get headers "type")))))
            (when (= "rule_proposal" (get headers "type"))
              (append-rule-proposal! headers))
            (move-with-collision path (sent-dir (get roles sender-role)))
            (log! "delivered" (str path)))))))))

(defn inbox-new-files [role-info]
  (let [new-dir (handoff-lib/mailbox-dir role-info :new)]
    (when (fs/exists? new-dir)
      (->> (fs/list-dir new-dir)
           (filter #(and (fs/regular-file? %)
                         (str/ends-with? (fs/file-name %) ".handoff")))
           seq))))

(defn outbox-files [role-info]
  (let [outbox (handoff-lib/mailbox-dir role-info :outbox)]
    (when (fs/exists? outbox)
      (->> (fs/list-dir outbox)
           (filter #(and (fs/regular-file? %)
                         (str/ends-with? (fs/file-name %) ".handoff")))
           (sort-by #(fs/file-name %))))))

(defn outbox-error-stubs [role-info]
  (let [outbox (handoff-lib/mailbox-dir role-info :outbox)]
    (when (fs/exists? outbox)
      (->> (fs/list-dir outbox)
           (filter #(and (fs/regular-file? %)
                         (str/ends-with? (fs/file-name %) ".handoff.error")))))))

(defn self-heal-stale-stubs!
  "Removes debris .error stubs left in outbox/ by past races (BL-083): if
   the stub's original handoff already made it into sent/, the delivery
   was never actually lost, so the stub is stale rather than a live issue."
  [roles]
  (doseq [[_ role-info] roles
          stub (or (outbox-error-stubs role-info) [])
          :let [original-name (str/replace (fs/file-name stub) #"\.error$" "")]
          :when (already-archived? role-info original-name)]
    (fs/delete stub)
    (log! "stale-stub-cleanup" (str stub) "original-in-sent" original-name)))

;; BL-617: while ANY pause is active (human-applied or the nightly
;; cooldown - both converge on the same control-pause.json, so ONE gate
;; covers both), outbound wakes are frozen: no inbox delivery, no chase
;; nudges, no rotate/open-slot wakes, no startup notify. Enqueue always
;; succeeds (parcels still land in outbox/); the freeze point is between
;; enqueue and delivery, and nothing is ever killed - an agent mid-turn
;; simply is not woken again. pause-auto-resume-sweep! and cooldown-sweep!
;; are the two sweeps that decide whether to CHANGE pause state - they are
;; wired directly into the cadence block, never gated by this check, or the
;; swarm could never thaw.
(defn outbound-wakes-suppressed? []
  (backlog-depth-lib/pause-active?
   (backlog-depth-lib/read-pause-state (str project-root))
   (System/currentTimeMillis)))

(defn startup-notify-pending! [roles socket]
  (when-not (or (tmux-inject-disabled?) (outbound-wakes-suppressed?))
    (doseq [[_ role-info] roles
            :let [role (:role role-info)]
            :when (and (seq (inbox-new-files role-info))
                       (not (recipient-pane-busy? socket roles role)))]
      (log! "startup-notify" role)
      (try
        (notify! socket (:session role-info) (:agent role-info))
        (catch Exception e
          (log! "startup-notify-error" role (.getMessage e)))))))

;; BL-655 site 1 (delivery): a held parcel is simply not delivered THIS
;; poll - it stays byte-identical in the sender's outbox/, untouched, and is
;; re-evaluated fresh next poll (never moved to failed/, sent/, or
;; quarantined). ambulance-state is read once per poll-once! call (still
;; "fresh at the moment of decision" - each poll IS a decision, ~1s apart),
;; never cached across polls.
(defn poll-once! []
  (if (outbound-wakes-suppressed?)
    (log! "poll-skip-paused" "delivery frozen while a pause is active")
    (let [roles (load-roles)
          socket (str/trim (slurp (str socket-file)))
          ambulance (ambulance-lib/read-ambulance-state (str project-root))
          outbox-items (for [[role role-info] roles
                             path (or (outbox-files role-info) [])]
                         [role path])]
      (when (and (seq outbox-items) (not (:active ambulance)))
        (log! "ambulance-inactive" "mode not engaged"))
      (doseq [[role path] outbox-items]
        (if (ambulance-lib/parcel-held? ambulance (handoff-lib/parse-envelope (slurp (str path))))
          (log! "deliver-skip-ambulance" (str path) (:ticket ambulance))
          (try
            (deliver! roles socket role path)
            (catch Exception e
              (log! "error" (str path) (.getMessage e))
              (if (already-archived? (get roles role) (fs/file-name path))
                (do
                  (log! "already-archived" (str path))
                  ;; The duplicate outbox copy is confirmed delivered (its
                  ;; twin already landed in sent/); archive it too instead of
                  ;; leaving it to be reprocessed and re-fail every poll cycle.
                  (try
                    (move-with-collision path (sent-dir (get roles role)))
                    (catch Exception _ignored nil)))
                (fail! path (.getMessage e))))))))))

;; ── BL-121: canary sweep - completes synthetic canary round-trips ──────────
;; The extension's canaryInjector.ts writes a pending marker under
;; canary-queue/pending/ on a schedule and later checks canary-queue/completed/
;; for a match (transportHealth.ts reads the resulting canary-status.json).
;; Moving pending -> completed here, inside THIS process's own poll loop,
;; means a canary only completes if the daemon is actually still iterating -
;; not just alive as an OS process. A wedged-but-running daemon lets pending
;; canaries pile up and eventually miss budget, which is exactly the
;; delivery-level signal BL-121 needs (never touches any role's real inbox,
;; so a canary can never appear as a work item - BL-121 canary-isolation-04).
(defn canary-pending-dir [] (fs/path daemon-dir "canary-queue" "pending"))
(defn canary-completed-dir [] (fs/path daemon-dir "canary-queue" "completed"))

(defn canary-sweep! []
  (let [pending-dir (canary-pending-dir)]
    (when (fs/exists? pending-dir)
      (doseq [f (->> (fs/list-dir pending-dir)
                     (filter #(and (fs/regular-file? %)
                                   (str/ends-with? (fs/file-name %) ".handoff"))))]
        (try
          (move-with-collision f (canary-completed-dir))
          (log! "canary-completed" (fs/file-name f))
          (catch Exception e
            (log! "canary-sweep-error" (str f) (.getMessage e))))))))

;; The JVM only waits for registered shutdown-hook THREADS to finish before
;; halting - it does not wait for arbitrary other threads. A hook that only
;; flips an atom returns in microseconds, so the poll loop (running on the
;; main thread) was being halted mid-cycle before it ever reached its own
;; `finally`, and pid-file cleanup on TERM silently never ran (BL-081: this
;; is why root cause #2's pid-aware delete was unreachable via the TERM
;; path - confirmed empirically, not from the ticket's own description).
;; Joining the main thread here makes the hook thread - which the JVM does
;; wait for - block until the poll loop actually finishes its `finally`.
(defn shutdown! []
  (reset! stopping? true)
  (when-let [t @main-thread]
    (.join t 5000)))

(def startup-notify-only?
  (some #{"--startup-notify-only"} *command-line-args*))

(def poll-once-only?
  (some #{"--poll-once"} *command-line-args*))

;; BL-655: same one-shot-and-exit posture as --poll-once/--startup-notify-
;; only above, for the OTHER daemon decision an acceptance test needs
;; deterministically: which dormant role (if any) the resident would rotate
;; to right now. Spinning up the full daemon loop + fake tmux + waiting out
;; the real chase-sweep cadence (~10s) to observe this is what the ambulance
;; wiring shell test already does for the true end-to-end proof; this flag
;; exists so an acceptance scenario can ask the SAME real
;; preferred-mono-rotate-role the resident's own chase sweep consults,
;; without a background process or a wall-clock wait.
(def print-preferred-rotate-target-only?
  (some #{"--print-preferred-rotate-target"} *command-line-args*))

;; BL-679: same one-shot-and-exit posture as --poll-once above, for one full
;; deterministic daemon cycle - delivery (poll-once!, so a bounce note
;; naming the ambulance ticket is observably delivered in the same pass) plus
;; the three sweeps this ticket added/modified (open-slot-nudge-sweep!'s
;; ambulance suppression, flow-watchdog-sweep!'s ambulance mute, and the new
;; ambulance-auto-exit-sweep!) - no real 10s chase-cadence wait, for the
;; acceptance suite's "the handoff daemon runs one sweep" / "the flow
;; watchdog sweep runs" steps.
(def sweep-once-only?
  (some #{"--sweep-once"} *command-line-args*))

;; BL-921: same one-shot-and-exit posture as --sweep-once above, but for the
;; chase sweep specifically - --sweep-once deliberately does NOT include
;; chase-sweep! (it runs delivery plus the ambulance/watchdog/nudge sweeps
;; only), and the full daemon loop only reaches chase-sweep! on its real
;; ~10s cadence. An acceptance scenario proving "N chase sweeps never
;; inject wake text for a diverged live identity" needs to run exactly N
;; sweeps deterministically, without a background process or a wall-clock
;; wait for the real cadence.
(def chase-sweep-once-only?
  (some #{"--chase-sweep-once"} *command-line-args*))

(defn own-pid [] (.pid (java.lang.ProcessHandle/current)))

(defn pid-alive? [pid]
  (when pid
    (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.isAlive))))

(defn process-command-line [pid]
  (let [{:keys [out exit]} (daemon-cycle-guard-lib/sh! "ps" "-o" "command=" "-p" (str pid))]
    (when (zero? exit) (str/trim out))))

(defn handoffd-for-this-root?
  "True when pid's command line is a handoffd.bb process started for THIS
   project-root, not merely a pid number that happens to be alive again
   after reuse, and not a handoffd.bb serving a different project (BL-081:
   reaping/guarding must never touch another project's daemon)."
  [pid]
  (when-let [cmd (process-command-line pid)]
    (and (str/includes? cmd "handoffd.bb")
         (str/includes? cmd project-root))))

(defn read-pid-file []
  (when (fs/exists? pid-file)
    (some-> (slurp (str pid-file)) str/trim not-empty parse-long)))

(defn live-conflicting-pid
  "The pid recorded in handoffd.pid, if it names a still-alive handoffd.bb
   process for this project-root other than ourselves. nil means it is safe
   to take ownership of the pid file (BL-081 root cause #1: a second start
   must not silently clobber a live daemon's pid file)."
  []
  (let [recorded (read-pid-file)]
    (when (and recorded (not= recorded (own-pid))
               (pid-alive? recorded)
               (handoffd-for-this-root? recorded))
      recorded)))

(defn with-pid-lock
  "Runs f while holding an exclusive lock on the pid file, using the same
   atomic mkdir-based lock pattern as swarm_handoff.bb's next-sequence, so
   two handoffd.bb processes racing to start at the same instant (e.g. the
   launcher and the supervisor) cannot both observe an empty pid file and
   both proceed (BL-081: the observed same-minute duplicate-start race)."
  [f]
  (fs/create-dirs daemon-dir)
  ;; BL-967: the spin carries a deadline (engineering rules: max-wait
  ;; deadlines on lock loops). A stale lock dir - e.g. left by a
  ;; freshness-kill landing inside the tiny lock window - previously spun
  ;; here silently forever; now it fails loudly instead.
  (loop [waited-ms 0]
    (when-not (try
                (fs/create-dir pid-lock-dir)
                true
                (catch java.nio.file.FileAlreadyExistsException _ false))
      (when (>= waited-ms 30000)
        (throw (ex-info (str "pid lock " pid-lock-dir " not released within 30s"
                             " - a stale lock dir from a killed process; remove it and retry")
                        {:lock-dir (str pid-lock-dir)})))
      (Thread/sleep 50)
      (recur (+ waited-ms 50))))
  (try
    (f)
    (finally
      (fs/delete pid-lock-dir))))

(defn claim-pid-file!
  "Attempts to take ownership of the pid file under the lock. Returns
   :claimed on success (pid file now names this process), or
   [:conflict pid] when a live handoffd.bb for this root already owns it."
  []
  (with-pid-lock
    (fn []
      (if-let [conflicting (live-conflicting-pid)]
        [:conflict conflicting]
        (do
          (fs/delete-if-exists stop-file)
          (spit (str pid-file) (str (own-pid) "\n"))
          :claimed)))))

(defn delete-own-pid-file!
  "Deletes the pid file only when it still names this process (BL-081 root
   cause #2: an orphan reaped by SIGTERM must not delete the SURVIVOR's pid
   file on its way out via this same shutdown path)."
  []
  (when (= (read-pid-file) (own-pid))
    (fs/delete-if-exists pid-file)))

;; ── BL-146: chase/nudge sweep - the daemon's second duty ────────────────────
;; Adapters wire chase-sweep-lib's pure decisions to real tmux/heartbeat
;; state, the same way `deliver!` above is the thin dispatch layer for
;; delivery. Decision logic itself stays reachable without live tmux (see
;; chase_sweep_lib.bb and its test_chase_sweep.sh coverage).

(defn parse-heartbeat
  "Parses a role's `.swarmforge/heartbeat/<role>.yaml` (written by
   extension/src/tools/heartbeat.ts's writeHeartbeat - a simple
   key: value format, not real YAML). Returns nil when absent/malformed,
   matching readHeartbeat's own contract."
  [role]
  (try
    (let [content (slurp (str (fs/path heartbeat-dir (str role ".yaml"))))
          fields (into {}
                       (for [line (str/split-lines content)
                             :let [m (re-matches #"(\w+):\s*(.+)" (str/trim line))]
                             :when m]
                         [(keyword (nth m 1)) (str/replace (nth m 2) #"^\"(.*)\"$" "$1")]))]
      (when (contains? fields :last_beat)
        {:last_beat (:last_beat fields)
         :in_flight (= "true" (:in_flight fields))
         :pid (some-> (:pid fields) parse-long)}))
    (catch Exception _ nil)))

(defn get-liveness [role]
  (let [hb (parse-heartbeat role)
        pid-live? (boolean (and hb (:pid hb) (pid-alive? (:pid hb))))]
    (chase-sweep-lib/compute-liveness
     hb (System/currentTimeMillis)
     {:staleTimeoutSeconds 30 :inFlightTimeoutSeconds 60 :deadTimeoutSeconds 120}
     pid-live?)))

(defn capture-pane-lines
  "Same as capture-pane-text but limited to the last n lines, mirroring
   tmuxClient.ts's capturePane(socket, target, -50) used for activity
   tracking."
  [socket session n]
  (:out (tmux! "-S" socket "capture-pane" "-p" "-t" session "-S" (str "-" n))))

(defn get-last-activity-ms [role-info socket now-ms]
  ;; Loop detection is NOT done here: bb/SCI cannot forward-reference
  ;; observe-pane-loop! (defined later). Standing sessions are observed from
  ;; chase-sweep! → observe-standing-role-loops! instead, which also covers
  ;; the empty-mailbox NO_TASK spin that in_process-gated activity misses.
  (let [pane (try (capture-pane-lines socket (:session role-info) 50) (catch Exception _ ""))
        outbox-dir (handoff-lib/mailbox-dir role-info :outbox)
        sent-dir* (handoff-lib/mailbox-dir role-info :sent)
        outbox-activity-ms (apply max 0
                                   (for [d [outbox-dir sent-dir*] :when (fs/exists? d)]
                                     (.toMillis (fs/last-modified-time d))))]
    (chase-sweep-lib/track-pane-activity! (:role role-info) pane outbox-activity-ms now-ms)))

(defn openrouter-respawn-env-args
  "BL-130: OPENROUTER_API_KEY must reach the pane via ephemeral tmux -e, never
   a launch-script export. launch_role in swarmforge.sh already does this on
   first start; chase/ensure respawns historically omitted -e, so an
   OpenRouter-backed pane came back with an empty ANTHROPIC_AUTH_TOKEN and
   then failed every turn (malformed/empty HTTP 200). Pass the key (and the
   optional max-output cap) whenever they are present in the daemon env."
  []
  (cond-> []
    (not (str/blank? (System/getenv "OPENROUTER_API_KEY")))
    (concat ["-e" (str "OPENROUTER_API_KEY=" (System/getenv "OPENROUTER_API_KEY"))])
    (not (str/blank? (System/getenv "CLAUDE_CODE_MAX_OUTPUT_TOKENS")))
    (concat ["-e" (str "CLAUDE_CODE_MAX_OUTPUT_TOKENS=" (System/getenv "CLAUDE_CODE_MAX_OUTPUT_TOKENS"))])))

(defn do-respawn!
  "Busy-vs-wedged precheck (BL-137/BL-147 parity): never types/respawns into
   a pane showing Claude Code's busy footer. Otherwise force-relaunches the
   role's persisted launch script in place, the same tmux respawn-pane -k
   invocation launch_role/swarm_ensure.bb already use.

   Launch script is always the canonical project-root
   .swarmforge/launch/<role>.sh (same as swarm_ensure.bb/respawn-role!) —
   never a worktree-local copy, which can drift or be missing and which once
   left the coordinator session running the coder script after a bad repair."
  [role-info socket]
  (let [session (:session role-info)
        role (:role role-info)
        pane (try (capture-pane-text socket session) (catch Exception _ ""))]
    (if (chase-sweep-lib/actively-processing? pane)
      (log! "chase-respawn-skip-busy" role)
      (let [launch-script (fs/path state-dir "launch" (str role ".sh"))
            env-args (openrouter-respawn-env-args)]
        (log! "chase-respawn" role (str launch-script))
        (apply tmux! (concat ["-S" socket "respawn-pane" "-k"]
                             env-args
                             ["-t" session (shell-quote-lib/launch-command launch-script)]))))))

(defn write-chase-status! [now-ms]
  (fs/create-dirs daemon-dir)
  (let [existing (try (json/parse-string (slurp (str duties-file)) true) (catch Exception _ {}))
        updated (assoc existing
                       :pid (own-pid)
                       :delivery {:last_sweep_at (now)}
                       :chase {:last_sweep_at (now)})]
    (spit (str duties-file) (json/generate-string updated))))

;; BL-499: completed-dir/abandoned-dir added so chase-sweep-lib/run-sweep!
;; can reap a new/ duplicate whose basename is already terminal there -
;; the SAME two directories ready_for_next_task.bb's own dequeue-time
;; dedup already reads (BL-218), never a second lookup.
(defn role-inboxes-for-chase [roles]
  (for [[role role-info] roles]
    {:role role
     :inbox-new-dir (str (handoff-lib/mailbox-dir role-info :new))
     :in-process-dir (str (handoff-lib/mailbox-dir role-info :in_process))
     :completed-dir (str (handoff-lib/mailbox-dir role-info :completed))
     :abandoned-dir (str (handoff-lib/mailbox-dir role-info :abandoned))}))

;; BL-098: durable per-role chase/nudge/dead-letter/respawn telemetry. The
;; existing .chase.json/.nudge sidecars are ephemeral (abandoned once an
;; item completes), so nothing durable could answer "how many nudges did a
;; role need this week?" One JSON line per event, keyed by month like
;; rule-proposals-file above; a `type` field keeps the schema additive so a
;; later stage-transition event (BL-097 dwell/bounce) can share this log.
(defn chaser-telemetry-file [at-ms]
  (fs/path state-dir "telemetry"
           (str "chaser-"
                (.format (java.time.format.DateTimeFormatter/ofPattern "yyyy-MM")
                         (.atZone (java.time.Instant/ofEpochMilli at-ms) java.time.ZoneOffset/UTC))
                ".jsonl")))

(defn log-chaser-telemetry! [event at-ms]
  (let [file (chaser-telemetry-file at-ms)
        line (json/generate-string
              (assoc event :at
                     (.format (java.time.format.DateTimeFormatter/ISO_INSTANT)
                              (java.time.Instant/ofEpochMilli at-ms))))]
    (fs/create-dirs (fs/parent file))
    (spit (str file) (str line "\n") :append true)))

;; BL-870: durable per-wake attribution - one JSON line for every wake the
;; daemon's own wake path (notify!/notify-in-process-resume! via
;; chase-poke-and-notify!, and the claim-idle probe injector) injects OR
;; withholds, naming the role, the deciding sweep, and the handoff that
;; motivated it (or an explicit absent marker). Same monthly-file/JSONL
;; shape as chaser-telemetry-file above, kept as its own file rather than
;; folded into that log because chaser telemetry today only ever records
;; the cases that DID something (chase/nudge/respawn/...); this must also
;; cover the skipped half, which chaser telemetry never has.
(defn wake-attribution-file [at-ms]
  (fs/path state-dir "telemetry"
           (str "wake-attribution-"
                (.format (java.time.format.DateTimeFormatter/ofPattern "yyyy-MM")
                         (.atZone (java.time.Instant/ofEpochMilli at-ms) java.time.ZoneOffset/UTC))
                ".jsonl")))

(defn record-wake-attribution!
  "Never throws - a failure to record must never block the wake it is
   describing (invariant 2: attribution is observation only). role-info is
   the full roles.tsv row (record-wake-attribution! reads its own mailbox
   fresh via wake-attribution-lib/motivating-handoff), not just the role
   name."
  [role-info sweep dir-key outcome & {:keys [skip-reason]}]
  (try
    (let [at-ms (System/currentTimeMillis)
          handoff-id (wake-attribution-lib/motivating-handoff role-info dir-key)
          record (wake-attribution-lib/build-attribution
                  {:role (:role role-info) :sweep sweep :handoff-id handoff-id
                   :outcome outcome :at-ms at-ms :skip-reason skip-reason})
          line (json/generate-string
                (assoc record :at
                       (.format (java.time.format.DateTimeFormatter/ISO_INSTANT)
                                (java.time.Instant/ofEpochMilli at-ms))))
          file (wake-attribution-file at-ms)]
      (fs/create-dirs (fs/parent file))
      (spit (str file) (str line "\n") :append true))
    (catch Exception e
      (log! "wake-attribution-error" (:role role-info) (.getMessage e)))))

;; ── BL-349: stuck-escalation email - the daemon's missing leg ───────────
;; write-escalation! (chase_sweep_lib.bb) only ever wrote a file; the only
;; code that EMAILED it lived in the VS Code extension host
;; (NeedsHumanEmailNotifier), so on a headless box the human was never
;; told. Reuses daemon_alarm_lib.bb's send-configured-email! exactly as
;; send-configured-briefing-email! above does, so there is still only ONE
;; Resend client in the whole swarm. stuck_escalation_email_lib.bb owns
;; the pure delivery-based arming (BL-345's shape, reapplied per-role) and
;; the durable per-role state; this is the thin, environment-specific
;; wiring.
(defn env-ms [name default]
  (or (some-> (System/getenv name) parse-long) default))

(def escalation-alarm-retry-config
  {:max-attempts (env-ms "ESCALATION_ALARM_MAX_ATTEMPTS" 5)
   :backoff-base-ms (env-ms "ESCALATION_ALARM_BACKOFF_BASE_MS" 60000)
   :backoff-max-ms (env-ms "ESCALATION_ALARM_BACKOFF_MAX_MS" 1800000)})

;; One-shot per process, same rationale as briefing-missing-key-warned?/
;; starvation-email-key-warned? - a separate atom because this is a
;; separate signal (and, for the daemon-vs-runtime split, a separate
;; process).
(def escalation-email-missing-key-warned? (atom false))

;; BL-349 E2E test seam, mirroring operator_runtime.bb's own BL-345
;; OPERATOR_ALARM_FORCE_RESULT convention exactly: when set, short-circuits
;; the real send entirely and returns this JSON-decoded result instead -
;; lets the acceptance suite drive the REAL sweep/arming logic (retry
;; counting, backoff, give-up logging) against a scripted transient-
;; failure/success sequence without ever reaching daemon-alarm-lib or the
;; network. Never set in production.
(defn send-escalation-alarm-email! [subject text]
  (if-let [forced (System/getenv "ESCALATION_ALARM_FORCE_RESULT")]
    (json/parse-string forced true)
    (daemon-alarm-lib/send-configured-email!
     project-root conf-file subject text
     {:already-warned?! (fn [] @escalation-email-missing-key-warned?)
      :log-warning! (fn [msg] (log! "email-misconfigured" msg))
      :mark-warned! (fn [] (reset! escalation-email-missing-key-warned? true))})))

(defn halt-for-endless-loop!
  "Hard-stop the swarm when a role is burning tokens on a NO_TASK spin.
   Alerts first (Telegram Operator topic + email), then touches the supervisor
   stop file and runs kill_all_swarm.sh. compare-and-set so concurrent chase
   observations only halt once. Alert order is intentional: outbox + email
   land on disk/network before tmux/daemon teardown."
  [role state]
  (when (compare-and-set! loop-halt-triggered? false true)
    (let [reason (loop-detect-lib/format-halt-reason role state)
          subject (loop-detect-lib/format-email-subject role)
          tg-text (loop-detect-lib/format-telegram-alert role state)
          reply-outbox (fs/path state-dir "operator" "telegram-reply-outbox.jsonl")]
      (log! "endless-loop-halt" role reason)
      ;; Telegram: same OPERATOR-topic outbox disk-space / idle-nudge use
      ;; (bridge polls telegram-reply-outbox.jsonl). Durable before kill.
      (try
        (fs/create-dirs (fs/parent reply-outbox))
        (spit (str reply-outbox)
              (str (json/generate-string {"threadId" "OPERATOR" "text" tg-text}) "\n")
              :append true)
        (log! "endless-loop-telegram" role)
        (catch Exception e (log! "endless-loop-telegram-error" (.getMessage e))))
      (try
        (daemon-alarm-lib/send-configured-email!
         project-root conf-file subject reason
         {:already-warned?! (fn [] @escalation-email-missing-key-warned?)
          :log-warning! (fn [msg] (log! "email-misconfigured" msg))
          :mark-warned! (fn [] (reset! escalation-email-missing-key-warned? true))})
        (log! "endless-loop-email" role)
        (catch Exception e (log! "endless-loop-email-error" (.getMessage e))))
      (try
        (fs/create-dirs daemon-dir)
        (spit (str stop-file) "")
        (catch Exception e (log! "endless-loop-stop-file-error" (.getMessage e))))
      (try
        (daemon-cycle-guard-lib/sh! ["bash" (str (fs/path script-dir "kill_all_swarm.sh")) (str project-root)])
        (catch Exception e (log! "endless-loop-kill-error" (.getMessage e)))))))

;; BL-528: claim-without-progress halt (separate atom so a claim-idle halt
;; does not suppress an in-flight NO_TASK halt and vice-versa).
(def claim-progress-halt-triggered? (atom false))

(defn halt-for-claim-progress! [role progress]
  (when (compare-and-set! claim-progress-halt-triggered? false true)
    (let [reclaims (or (:reclaims progress) 0)
          reason   (claim-progress-lib/format-halt-reason role reclaims)
          subject  (claim-progress-lib/format-email-subject role)
          tg-text  (claim-progress-lib/format-telegram-alert role reclaims)
          reply-outbox (fs/path state-dir "operator" "telegram-reply-outbox.jsonl")]
      (log! "claim-progress-halt" role reason)
      (try
        (fs/create-dirs (fs/parent reply-outbox))
        (spit (str reply-outbox)
              (str (json/generate-string {"threadId" "OPERATOR" "text" tg-text}) "\n")
              :append true)
        (log! "claim-progress-telegram" role)
        (catch Exception e (log! "claim-progress-telegram-error" (.getMessage e))))
      (try
        (daemon-alarm-lib/send-configured-email!
         project-root conf-file subject reason
         {:already-warned?! (fn [] @escalation-email-missing-key-warned?)
          :log-warning! (fn [msg] (log! "email-misconfigured" msg))
          :mark-warned! (fn [] (reset! escalation-email-missing-key-warned? true))})
        (log! "claim-progress-email" role)
        (catch Exception e (log! "claim-progress-email-error" (.getMessage e))))
      (try
        (fs/create-dirs daemon-dir)
        (spit (str stop-file) "")
        (catch Exception e (log! "claim-progress-stop-file-error" (.getMessage e))))
      (try
        (daemon-cycle-guard-lib/sh! ["bash" (str (fs/path script-dir "kill_all_swarm.sh")) (str project-root)])
        (catch Exception e (log! "claim-progress-kill-error" (.getMessage e)))))))

(defn observe-pane-loop!
  "Feed one pane snapshot into loop_detect_lib; halt the swarm on :halt."
  [role pane]
  (when-not @loop-halt-triggered?
    (let [prev (get @loop-detect-states role)
          decision (loop-detect-lib/decide-loop-action prev pane)]
      (swap! loop-detect-states assoc role (:state decision))
      (when (= :halt (:action decision))
        (halt-for-endless-loop! role (:state decision))))))


(defn stuck-escalation-email-sweep! [role escalated? now-ms]
  (try
    (stuck-escalation-email-lib/sweep!
     role escalated? now-ms (str daemon-dir) escalation-alarm-retry-config
     {:send-email! send-escalation-alarm-email!
      :log! (fn [& parts] (apply log! parts))})
    (catch Exception e
      (log! "stuck-escalation-email-error" role (.getMessage e)))))


(defn observe-standing-role-loops!
  "Walk every role that still has a live tmux session and feed its pane into
   the endless-loop detector. Must not depend on in_process mail — the classic
   token-burn failure is an empty mailbox with ready_for_next → NO_TASK spinning."
  [roles socket]
  (doseq [[role role-info] roles]
    (let [session (:session role-info)]
      (when (and session (handoff-lib/session-exists? socket session))
        ;; Last 20 lines only — older scrollback from a prior spin must not
        ;; false-positive a healthy idle prompt after relaunch.
        (let [pane (try (capture-pane-lines socket session 20) (catch Exception _ ""))]
          (observe-pane-loop! role pane))))))

;; ── BL-536: auth-class pane observe/respawn - SRE 2026-07-19 ───────────────
;; classify-provider-error already maps "Invalid API key" to :auth and
;; provider-compat-lib/provider-auth-error-text? already recognizes the same
;; text, but nothing observed pane scrollback for it and healed a standing
;; role wedged behind a credential error. Wired into the SAME chase-sweep!
;; cadence as observe-standing-role-loops! above (not the TS inboxChaser,
;; dead-in-production for chase decisions per BL-146). Respawn reuses
;; swarm_ensure.bb's own provider-respawn-env-args machinery, extracted into
;; provider_respawn_env_lib.bb so this daemon process can call it without
;; load-file'ing swarm_ensure.bb itself (which runs a full ensure sweep and
;; System/exit as a side effect of being loaded).

(defn- auth-respawn-max-attempts
  "BL-536: the effective config's auth_respawn_max_attempts — resolved via
   backlog-depth-lib/conf-file-path (whatever pack swarm-identity recorded
   at launch), never the tracked default file directly (same resolution as
   note-actionable-after-ms/rotation-starve-after-ms below)."
  []
  (provider-auth-observe-lib/parse-max-attempts
   (try (slurp (str (backlog-depth-lib/conf-file-path project-root)))
        (catch Exception _ nil))))

(defn do-auth-respawn!
  "BL-536: force-relaunch a role's persisted launch script with provider-
   compat env args after an auth-class failure was observed in its pane.
   Mirrors do-respawn!'s busy precheck exactly — never types/respawns into a
   pane showing Claude Code's busy footer."
  [role-info socket]
  (let [session (:session role-info)
        role (:role role-info)
        pane (try (capture-pane-text socket session) (catch Exception _ ""))]
    (if (chase-sweep-lib/actively-processing? pane)
      (log! "auth-respawn-skip-busy" role)
      (let [launch-script (fs/path state-dir "launch" (str role ".sh"))
            env-args (provider-respawn-env-lib/provider-respawn-env-args state-dir role)]
        (log! "auth-respawn" role (str launch-script))
        (apply tmux! (concat ["-S" socket "respawn-pane" "-k"]
                             env-args
                             ["-t" session (shell-quote-lib/launch-command launch-script)]))))))

(defn send-auth-persist-alert!
  "BL-536: reuses the same operator alert channel the endless-loop breaker
   uses (Telegram OPERATOR topic + email) — but never halts the swarm or
   kills sessions; this is a notify-only alert."
  [role max-attempts]
  (let [reply-outbox (fs/path state-dir "operator" "telegram-reply-outbox.jsonl")
        subject (provider-auth-observe-lib/format-email-subject role)
        tg-text (provider-auth-observe-lib/format-telegram-alert role max-attempts)
        reason (provider-auth-observe-lib/format-alert-reason role max-attempts)]
    (log! "auth-persist-alert" role reason)
    (try
      (fs/create-dirs (fs/parent reply-outbox))
      (spit (str reply-outbox)
            (str (json/generate-string {"threadId" "OPERATOR" "text" tg-text}) "\n")
            :append true)
      (log! "auth-persist-telegram" role)
      (catch Exception e (log! "auth-persist-telegram-error" (.getMessage e))))
    (try
      (daemon-alarm-lib/send-configured-email!
       project-root conf-file subject reason
       {:already-warned?! (fn [] @escalation-email-missing-key-warned?)
        :log-warning! (fn [msg] (log! "email-misconfigured" msg))
        :mark-warned! (fn [] (reset! escalation-email-missing-key-warned? true))})
      (log! "auth-persist-email" role)
      (catch Exception e (log! "auth-persist-email-error" (.getMessage e))))))

(defn observe-pane-auth!
  "Feed one pane snapshot into provider-auth-observe-lib; act on the result."
  [role-info socket pane]
  (let [role (:role role-info)
        prev (get @auth-observe-states role)
        max-attempts (auth-respawn-max-attempts)
        decision (provider-auth-observe-lib/decide-auth-observation
                  prev pane {:max-attempts max-attempts})]
    (swap! auth-observe-states assoc role (:state decision))
    (case (:action decision)
      :respawn (do-auth-respawn! role-info socket)
      :alert (send-auth-persist-alert! role max-attempts)
      :none nil)))

(defn- provider-outage-observe-min-interval-ms []
  (provider-outage-evidence-lib/parse-observe-min-interval-ms
   (try (slurp (str (backlog-depth-lib/conf-file-path project-root)))
        (catch Exception _ nil))))

(defn observe-pane-provider-outage!
  "BL-840: feed one pane snapshot (the SAME one observe-pane-auth! above
   already captured - no second tmux capture) into the provider-outage
   evidence store when its text classifies :unavailable
   (agent_runtime_lib.bb's classify-provider-error). Attributed to role-info's
   own configured provider (:agent - the BL-208 lookup), never guessed;
   a role with no configured provider records nothing, since there is
   nothing to attribute it to. Throttled by
   provider_outage_observe_min_interval_ms inside record-provider-outage!
   itself; never throws out to the caller."
  [role role-info pane]
  (when (and (not (str/blank? pane))
             (= :unavailable (:category (agent-runtime-lib/classify-provider-error pane))))
    (when-let [provider (:agent role-info)]
      (try
        (provider-outage-evidence-lib/record-provider-outage!
         (str state-dir) role provider pane (System/currentTimeMillis)
         (provider-outage-observe-min-interval-ms))
        (catch Exception e (log! "provider-outage-observe-error" role (.getMessage e)))))))

(defn observe-standing-role-auth!
  "Walk every role that still has a live tmux session and feed its pane into
   the auth-class observer AND (BL-840) the provider-outage evidence
   observer - the same 20-line scrollback capture serves both, never a
   second tmux capture. Same live-session gate and window as
   observe-standing-role-loops! above."
  [roles socket]
  (doseq [[role role-info] roles]
    (let [session (:session role-info)]
      (when (and session (handoff-lib/session-exists? socket session))
        (let [pane (try (capture-pane-lines socket session 20) (catch Exception _ ""))]
          (observe-pane-auth! role-info socket pane)
          (observe-pane-provider-outage! role role-info pane))))))

(def last-chase-rotate-at-ms (atom 0))

(defn- handoff-header-field [file-path field]
  (try
    (let [header (first (str/split (slurp file-path) #"\n\n" 2))
          prefix (str field ": ")]
      (some (fn [line] (when (str/starts-with? line prefix) (subs line (count prefix))))
            (str/split-lines (or header ""))))
    (catch Exception _ nil)))

(defn- note-actionable-after-ms
  "BL-576: the effective config's note_actionable_after_ms — resolved via
   backlog-depth-lib/conf-file-path (whatever pack swarm-identity recorded
   at launch), never the tracked default file directly."
  []
  (mono-router-lib/parse-note-actionable-after-ms
   (try (slurp (str (backlog-depth-lib/conf-file-path project-root)))
        (catch Exception _ nil))))

(defn- rotation-starve-after-ms
  "BL-651: the effective config's rotation_starve_after_ms, resolved the
   same way as note-actionable-after-ms above — via
   backlog-depth-lib/conf-file-path, never the tracked default file
   directly."
  []
  (mono-router-lib/parse-rotation-starve-after-ms
   (try (slurp (str (backlog-depth-lib/conf-file-path project-root)))
        (catch Exception _ nil))))

(defn- log-rotation-actionability-ordering-warnings!
  "BL-780 config-threshold-inversion: once at daemon start, name both values
   when rotation thresholds would alarm the human before the swarm may act on
   the same parcel. Compared against flow_watchdog_warn_ms (not the
   router-specific pair) — acceptance names that key explicitly;
   rotation-actionability gates apply to mono-router note/starve behaviour
   while the ticket's defect window is measured against the plain warn tier."
  []
  (let [warn-ms (:warn-ms (flow-watchdog-lib/read-thresholds project-root))
        conf-text (try (slurp (str (backlog-depth-lib/conf-file-path project-root)))
                       (catch Exception _ nil))
        note-ms (mono-router-lib/parse-note-actionable-after-ms conf-text)
        starve-ms (mono-router-lib/parse-rotation-starve-after-ms conf-text)]
    (doseq [msg (mono-router-lib/rotation-actionability-ordering-warnings
                 {:note-actionable-after-ms note-ms
                  :rotation-starve-after-ms starve-ms
                  :flow-watchdog-warn-ms warn-ms})]
      ;; required_wiring token config-threshold-inversion (alias of live key).
      (log! "config-threshold-inversion" msg)
      (log! "rotation-actionability-ordering-inverted" msg))))

(defn- handoff-envelope
  "The full {:headers :body} shape ambulance-lib/parcel-held? needs (task:/
   message:/body attribution) - handoff-header-field above only ever reads
   ONE named header, not enough to decide attribution."
  [file-path]
  (try (handoff-lib/parse-envelope (slurp file-path)) (catch Exception _ {:headers {} :body ""})))

(defn- role-mail-row
  "Score one role's mailbox for mono-router rotate preference. BL-655 site 3:
   a held git_handoff/note is filtered out of the candidate set BEFORE
   actionable?/newest-created-at are computed - ambulance filters the
   candidates, BL-576's aged-note rule still decides among what survives the
   filter. In-process (already-claimed) work is never filtered here - an
   ambulance never retracts a mid-turn claim, so it stays actionable exactly
   as before regardless of which ticket it names.
   BL-636: :best-priority is the lowest parseable priority among the same
   actionable set (held + git_handoff + rule_proposal + aged notes) — a role
   ranks by its best parcel, not by whichever parcel happens to be newest.
   BL-651: :oldest-actionable-waited-ms is how long, in ms, the OLDEST
   actionable parcel has waited — age source is the parcel's own
   enqueued_at/created_at header, never file mtime (mono-router-lib/
   oldest-actionable-waited-ms), so the pure starve rule in
   preferred-rotate-target can fire in production.
   rule_proposal joins git_handoff as immediately actionable (2026-08-03):
   directed Article 5.1 mail must rotate the resident, not sit forever
   behind chase-rotate-skip-broadcast."
  [role role-info]
  (let [new-dir (str (handoff-lib/mailbox-dir role-info :new))
        ip-dir (str (handoff-lib/mailbox-dir role-info :in_process))
        held (chase-sweep-lib/scan-in-process ip-dir)
        ambulance (ambulance-lib/read-ambulance-state (str project-root))
        news (remove #(ambulance-lib/parcel-held? ambulance (handoff-envelope (:filePath %)))
                     (chase-sweep-lib/scan-inbox-new new-dir))
        git-hfs (filterv #(= "git_handoff" (handoff-header-field (:filePath %) "type")) news)
        rule-props (filterv #(= "rule_proposal" (handoff-header-field (:filePath %) "type")) news)
        note-fs (filterv #(= "note" (handoff-header-field (:filePath %) "type")) news)
        now-ms (System/currentTimeMillis)
        threshold-ms (note-actionable-after-ms)
        aged-notes (filterv #(mono-router-lib/note-aged?
                              {:enqueued-at (handoff-header-field (:filePath %) "enqueued_at")
                               :created-at (handoff-header-field (:filePath %) "created_at")
                               :now-ms now-ms
                               :threshold-ms threshold-ms})
                            note-fs)
        actionable-parcels (concat held git-hfs rule-props aged-notes)
        newest (or (->> actionable-parcels
                        (keep #(handoff-header-field (:filePath %) "created_at"))
                        sort
                        last)
                   "")
        best-priority (mono-router-lib/best-priority-rank
                       (map #(handoff-header-field (:filePath %) "priority")
                            actionable-parcels))
        oldest-waited-ms (mono-router-lib/oldest-actionable-waited-ms
                          (map #(hash-map :enqueued-at (handoff-header-field (:filePath %) "enqueued_at")
                                          :created-at (handoff-header-field (:filePath %) "created_at"))
                               actionable-parcels)
                          now-ms)]
    {:role role
     :newest-created-at newest
     :best-priority best-priority
     :oldest-actionable-waited-ms oldest-waited-ms
     :actionable? (mono-router-lib/actionable-mail?
                   {:in-process-count (count held)
                    :git-handoff-count (count git-hfs)
                    :rule-proposal-count (count rule-props)
                    :aged-note-count (count aged-notes)})}))

(defn preferred-mono-rotate-role
  "At most one dormant role may rotate the resident per decision — the one
   with the best (lowest) handoff priority among actionable mail; at equal
   priority, the OLDEST row past `rotation_starve_after_ms` wins, else
   newest wins (BL-636/BL-651). A note aged past `note_actionable_after_ms`
   qualifies; fresh broadcast notes still don't (BL-576)."
  [roles]
  (mono-router-lib/preferred-rotate-target
   (map (fn [[role ri]] (role-mail-row role ri)) roles)
   (rotation-starve-after-ms)))

(defn resident-pane-busy?
  "True when the mono-router resident pane shows a busy footer — do not
   rotate or inject wake spam mid-turn (chase thrash incident 2026-07-19)."
  [socket]
  (if-let [sess (handoff-lib/mono-router-resident-session)]
    (let [pane (try (capture-pane-text socket sess) (catch Exception _ ""))]
      (chase-sweep-lib/actively-processing? pane))
    false))

(defn resident-recently-active?
  "Very recent resident pane churn (spinner gaps between busy-footer frames)."
  [now-ms]
  (let [activity-role (or (handoff-lib/read-mono-router-active-role)
                          (handoff-lib/mono-router-home-role))]
    (boolean
     (and activity-role
          (chase-sweep-lib/pane-recently-active?
           activity-role now-ms chase-resident-recent-activity-ms)))))


(defn- ambulance-patient-waiting-at?
  "True when ambulance is engaged and target-role inbox/new holds a parcel
   attributed to the patient ticket (BL-691 D2 — busy must not defer it)."
  [target-role]
  (let [ambulance (ambulance-lib/read-ambulance-state (str project-root))
        role-info (get (load-roles) target-role)]
    (boolean
     (and (:active ambulance)
          role-info
          (let [new-dir (str (handoff-lib/mailbox-dir role-info :new))
                ticket (:ticket ambulance)]
            (some (fn [item]
                    (contains? (ambulance-lib/attributed-tickets
                                (handoff-envelope (:filePath item)))
                               ticket))
                  (chase-sweep-lib/scan-inbox-new new-dir)))))))

(defn- attempt-resident-rotate!
  "Shared gate+rotate for chase. Returns the rotate-resident-to! result map,
   or {:ok false :reason ...} when the busy/cooldown/already-active gate
   refuses. Logs the same chase-rotate-* lines the single-target path used."
  [socket target-role]
  (let [gate (mono-router-lib/should-rotate-resident?
              {:active-role (handoff-lib/read-mono-router-active-role)
               :target-role target-role
               ;; BL-921: a stale marker claiming the resident is already
               ;; target-role must not refuse the very rotate that would fix it.
               :live-role (handoff-lib/resident-live-role socket (handoff-lib/mono-router-resident-session))
               :resident-busy? (resident-pane-busy? socket)
               :ignore-busy? (ambulance-patient-waiting-at? target-role)
               :last-rotate-at-ms @last-chase-rotate-at-ms
               :now-ms (System/currentTimeMillis)
               :cooldown-ms mono-router-lib/default-rotate-cooldown-ms})]
    (if (not= gate :rotate)
      (do (log! (str "chase-rotate-" (name gate)) target-role)
          {:ok false :reason (name gate)})
      (let [result (handoff-lib/rotate-resident-to! target-role)]
        (when (:ok result)
          (reset! last-chase-rotate-at-ms (System/currentTimeMillis))
          (log! "chase-rotate" target-role))
        (when-not (:ok result)
          (log! "chase-rotate-error" target-role (str (:reason result))))
        result))))

;; BL-795/BL-654: invariant 2 ("a chase poke at a non-preferred role
;; redirects the resident onto the preferred actionable role rather than
;; returning not-preferred and dropping the rotate") has no executable
;; property-test encoding. The decision itself (preferred truthy and
;; different from the polled role -> redirect) is two lines of pure boolean
;; logic, but it is inlined in chase-rotate-to! below, which is otherwise
;; entirely IO: preferred-mono-rotate-role/role-mail-row scan the real
;; mailbox filesystem and ambulance state, and attempt-resident-rotate!
;; captures the live resident tmux pane over a real socket and performs the
;; actual rotation. Extracting the decision into a standalone pure function
;; to make it property-testable would be a structural change to this
;; adopted-as-is hand fix (BL-795's scope is explicitly "adopt the files
;; above as-is for the three invariants", not redesign them), and the
;; Babashka toolchain has no property-test framework wired for this
;; daemon-control-flow layer regardless (Engineering Rules: Babashka
;; mutation/CRAP/DRY tooling not wired; the .bb unit-test suite is the real
;; gate). The invariant is instead encoded as a real-fixture integration
;; test: test_handoffd_rule_proposal_rotate_wiring.sh scenario C drives the
;; actual handoffd.bb --print-preferred-rotate-target path and proves the
;; PRECONDITION this redirect depends on (an in_process priority-00 claim
;; outranks a rule_proposal priority-50) resolves correctly through the real
;; system, matching this project's established pattern for daemon-level
;; behavior (see this ticket's own e2e QA procedure).
(defn chase-rotate-to!
  "Rotate the mono-router resident onto `role` when that role's mail is the
   preferred actionable target. When another role is preferred, REDIRECT to
   that preferred role instead of returning not-preferred and dropping the
   poke (2026-08-03: hardender held in_process while chase burned cycles on
   specifier's skip-not-preferred / skip-broadcast — preferred was never
   acted on because only the poked role could land a rotate)."
  [socket roles role]
  (let [preferred (preferred-mono-rotate-role roles)
        row (role-mail-row role (get roles role))]
    (cond
      (and preferred (not= preferred role))
      (do (log! "chase-rotate-redirect" role preferred)
          (attempt-resident-rotate! socket preferred))

      (not (:actionable? row))
      (do (log! "chase-rotate-skip-broadcast" role)
          {:ok false :reason "broadcast"})

      :else
      (attempt-resident-rotate! socket role))))

(defn chase-poke-and-notify!
  "Shared chase wake/resume path. Gating is scoped to the pane the poke
   will actually land on (mono-router-lib/chase-poke-plan): pokes at the
   shared resident pane defer on busy/recent churn and share one inject
   per sweep; pokes at a role's own standing pane (classic packs) are
   gated only by that pane's own busy state. The per-sweep resident budget
   is consumed ONLY when a wake or rotate actually lands — a refused
   rotate (broadcast/cooldown) leaves the budget for the
   next role in the same sweep (architect starvation, 2026-07-23). A
   not-preferred poke now REDIRECTS to the preferred role (chase-rotate-to!)
   rather than consuming nothing and dropping the opportunity.
   Returns true only when a wake or successful rotate was performed.

   BL-870: `sweep` (wake-attribution-lib/sweep-inbox-item or
   sweep-stuck-in-process) and `mailbox-dir-key` (:new or :in_process) are
   supplied by the two callers below purely so a wake or skip can be
   attributed - neither is consulted by chase-poke-plan above, so they
   cannot change :mode (invariant 2). :rotate is not attributed here: it
   respawns the pane rather than injecting wake text into an existing one,
   so it is not a case this ticket's 'no wake text reaches a pane without
   attribution' invariant covers."
  [socket roles role resident-wake-suppressed? notify-fn! sweep mailbox-dir-key]
  (let [action (chase-poke-action roles socket role)
        ri (get roles role)
        wake-sess (handoff-lib/wake-session socket (:session ri))
        resident-target? (mono-router-lib/resident-poke-target?
                          {:action action
                           :wake-session wake-sess
                           :resident-session (handoff-lib/mono-router-resident-session)})
        plan (mono-router-lib/chase-poke-plan
              {:action action
               :resident-target? resident-target?
               :target-pane-busy?
               (when-not resident-target?
                 (let [pane (try (capture-pane-text socket wake-sess)
                                 (catch Exception _ ""))]
                   (chase-sweep-lib/actively-processing? pane)))
               :resident-busy? (when resident-target? (resident-pane-busy? socket))
               :resident-recently-active?
               (when resident-target?
                 (resident-recently-active? (System/currentTimeMillis)))
               :resident-woken-this-sweep? @resident-wake-suppressed?})]
    (case (:mode plan)
      :skip (do (log! (str "chase-wake-skip-" (name (:skip-reason plan))) role)
                (record-wake-attribution! ri sweep mailbox-dir-key
                                           wake-attribution-lib/outcome-skipped
                                           :skip-reason (name (:skip-reason plan)))
                false)
      :rotate (let [performed (boolean (:ok (chase-rotate-to! socket roles role)))]
                (when performed (reset! resident-wake-suppressed? true))
                performed)
      :wake (do (when (:resident-budget? plan)
                  (reset! resident-wake-suppressed? true))
                (notify-fn! socket (:session ri) (:agent ri))
                (record-wake-attribution! ri sweep mailbox-dir-key
                                           wake-attribution-lib/outcome-landed)
                true))))

(defn- head-commit-10
  "Exactly 10 hex chars for swarm_handoff.bb's git_handoff commit contract."
  []
  (let [result (daemon-cycle-guard-lib/sh! ["git" "rev-parse" "--short=10" "HEAD"] {:dir (str project-root)})]
    (when (zero? (:exit result))
      (str/trim (:out result)))))

(defn- worktree-head-commit-10
  "BL-528: 10-char HEAD of a role's worktree, or \"\" on error.
   Uses the worktree-path from loaded roles so each role's own branch is
   read, not the master checkout."
  [roles role]
  (let [ri  (get roles role)
        dir (or (:worktree-path ri) (str project-root))]
    (try
      (let [result (daemon-cycle-guard-lib/sh! ["git" "rev-parse" "--short=10" "HEAD"] {:dir dir})]
        (if (zero? (:exit result)) (str/trim (:out result)) ""))
      (catch Exception _ ""))))

(defn- role-worktree-dirty?
  "True when a role's worktree has staged/modified/untracked files."
  [roles role]
  (let [ri  (get roles role)
        dir (or (:worktree-path ri) (str project-root))]
    (try
      (let [result (daemon-cycle-guard-lib/sh! ["git" "status" "--porcelain"] {:dir dir})]
        (when (zero? (:exit result))
          (claim-progress-lib/worktree-dirty? (:out result))))
      (catch Exception _ false))))

(defn rotation-router-mode?
  "True when this project is running (or last launched as) rotation router.
   Same resolution as swarm_ensure.bb: swarm-identity rotation key, else the
   persisted active pack conf path, else swarmforge/swarmforge.conf."
  []
  (let [identity-path (fs/path state-dir "swarm-identity")
        identity-text (when (fs/exists? identity-path) (slurp (str identity-path)))
        conf-path (or (get (mono-router-lib/parse-identity-map (or identity-text ""))
                           "active_backlog_max_depth_conf_path")
                      (str conf-file))
        conf-text (when (and conf-path (fs/exists? conf-path))
                    (slurp conf-path))]
    (boolean
     (or (mono-router-lib/rotation-router-from-identity? identity-text)
         (mono-router-lib/conf-rotation-router? conf-text)))))

(defn- claim-idle-context [socket roles role now-ms]
  (let [active (handoff-lib/read-mono-router-active-role)
        activity-role (or active role)]
    {:resident-busy? (resident-pane-busy? socket)
     :resident-recently-active? (chase-sweep-lib/pane-recently-active?
                                  activity-role now-ms claim-recent-activity-ms)
     :active-role active
     :rotation-router? (rotation-router-mode?)}))

(defn- note-chase-control-plane-failure!
  "BL-958: a failed chase tmux send is the daemon's view of the crash class
   where the tmux server disappears while the daemons stay up. Probe and
   classify through the shared control_plane_lib and persist exactly one
   open structured incident for the loss (socket, probe output, expected
   sessions, response decision) — the artifact the live 2026-08-19 incident
   never produced. Recording must never take the sweep down with it."
  [socket roles]
  (try
    (let [result (control-plane-lib/record-chase-failure-incident!
                  {:state-dir (str state-dir)
                   :socket socket
                   :expected-sessions (vec (sort (keep :session (vals roles))))
                   :observed-at (str (java.time.Instant/now))
                   :source "handoffd-chase"})]
      (when (:recorded? result)
        (log! "control-plane-incident-recorded"
              (str (control-plane-lib/incidents-file state-dir)))))
    (catch Exception e
      (log! "control-plane-incident-error" (.getMessage e)))))

(defn chase-sweep! [roles socket]
  (let [now-ms (System/currentTimeMillis)
        resident-wake-suppressed? (atom false)
        adapters {:get-liveness get-liveness
                  :send-wake-up! (fn [role]
                                    (if (tmux-inject-disabled?)
                                      false
                                      (try
                                        (chase-poke-and-notify!
                                         socket roles role resident-wake-suppressed?
                                         (fn [s sess agent] (notify! s sess agent))
                                         wake-attribution-lib/sweep-inbox-item :new)
                                        (catch Exception e
                                          (log! "chase-wake-error" role (.getMessage e))
                                          (note-chase-control-plane-failure! socket roles)
                                          false))))
                  :send-in-process-resume! (fn [role]
                                              (if (tmux-inject-disabled?)
                                                false
                                                (try
                                                  (chase-poke-and-notify!
                                                   socket roles role resident-wake-suppressed?
                                                   (fn [s sess agent]
                                                     (notify-in-process-resume! s sess agent))
                                                   wake-attribution-lib/sweep-stuck-in-process :in_process)
                                                  (catch Exception e
                                                    (log! "chase-in-process-resume-error" role (.getMessage e))
                                                    (note-chase-control-plane-failure! socket roles)
                                                    false))))
                  :trigger-respawn! (fn [role]
                                       (try
                                         ;; Busy gating is scoped like chase-poke-and-notify!:
                                         ;; only pokes landing on the shared resident pane defer
                                         ;; on its busy state. A classic-pack role's own respawn
                                         ;; (liveness-driven, own dead pane) must not be blocked
                                         ;; by an unrelated busy resident/coder pane.
                                         (let [action (chase-poke-action roles socket role)
                                               ri (get roles role)
                                               resident-target?
                                               (mono-router-lib/resident-poke-target?
                                                {:action action
                                                 :wake-session (handoff-lib/wake-session socket (:session ri))
                                                 :resident-session (handoff-lib/mono-router-resident-session)})]
                                           (cond
                                             (and resident-target? (resident-pane-busy? socket))
                                             (log! "chase-respawn-skip-busy" role)

                                             (contains? #{:rotate :wake-resident} action)
                                             (chase-rotate-to! socket roles role)

                                             :else (do-respawn! ri socket)))
                                         (catch Exception e (log! "chase-respawn-error" role (.getMessage e)))))
                  :log-dead-letter! (fn [role path] (log! "dead-letter" role (fs/file-name path)))
                  :get-last-activity-ms (fn [role] (get-last-activity-ms (get roles role) socket now-ms))
                  :on-stuck-escalation! (fn [role escalated?]
                                          (chase-sweep-lib/write-escalation! (str daemon-dir) role escalated?)
                                          ;; Mono-router dormant roles keep roles.tsv session names
                                          ;; with no standing pane. Emailing "specifier is stuck"
                                          ;; for a mailbox-only rotate target floods the human and
                                          ;; cannot be fixed by attaching that session. Still record
                                          ;; chase-escalations.json for consoles; skip the email.
                                          (let [session (:session (get roles role))]
                                            (when (mono-router-lib/should-send-stuck-escalation-email?
                                                   {:escalated? escalated?
                                                    :session-exists? (boolean
                                                                     (and session
                                                                          (handoff-lib/session-exists? socket session)))})
                                              (stuck-escalation-email-sweep! role escalated? now-ms))))
                  ;; BL-208: :provider is the one common, brand-name field
                  ;; every telemetry event now carries (chase_sweep_lib.bb
                  ;; itself stays agent-agnostic - this is the only place
                  ;; that knows which agent a role runs, same lookup
                  ;; :send-wake-up! above already does) so a reader can
                  ;; compare providers without a per-role branch.
                  :log-telemetry! (fn [event at-ms]
                                     (try (log-chaser-telemetry!
                                           (assoc event :provider (:agent (get roles (:role event))))
                                           at-ms)
                                          (catch Exception e (log! "telemetry-error" (:type event) (.getMessage e)))))
                  ;; BL-209: the shared rate-limit cooldown file the
                  ;; extension writes to (one file, every role - state-dir
                  ;; is the one directory every role's worktree shares).
                  :get-rate-limit-cooldown-until-ms
                  (fn [role] (chase-sweep-lib/read-rate-limit-cooldown-until-ms (str state-dir) role))
                  :get-rate-limit-cooldown-woken-marker
                  (fn [role] (chase-sweep-lib/read-rate-limit-cooldown-woken-marker (str state-dir) role))
                  :mark-rate-limit-cooldown-woken!
                  (fn [role until-ms] (chase-sweep-lib/mark-rate-limit-cooldown-woken! (str state-dir) role until-ms))
                  ;; BL-528: claim-without-progress adapters.
                  :get-role-head-commit
                  (fn [role] (worktree-head-commit-10 roles role))
                  :role-agent-busy?
                  (fn [role] (boolean (recipient-pane-busy? socket roles role)))
                  :role-worktree-dirty?
                  (fn [role] (boolean (role-worktree-dirty? roles role)))
                  :claim-idle-context
                  (fn [role] (claim-idle-context socket roles role now-ms))
                  :send-claim-idle-probe!
                  (fn [role message]
                    (when-not (tmux-inject-disabled?)
                      (try
                        (let [ri (get roles role)]
                          (if (resident-pane-busy? socket)
                            (do (log! "claim-idle-probe-skip-busy" role)
                                (when ri
                                  (record-wake-attribution!
                                   ri wake-attribution-lib/sweep-claim-idle-probe :in_process
                                   wake-attribution-lib/outcome-skipped :skip-reason "busy")))
                            (when ri
                              (let [session (handoff-lib/wake-session socket (:session ri))]
                                (agent-runtime-inject/notify-agent!
                                 socket session (or (:agent ri) "claude")
                                 :log-fn (fn [tag sess detail] (log! tag sess detail))
                                 :text message)
                                (record-wake-attribution!
                                 ri wake-attribution-lib/sweep-claim-idle-probe :in_process
                                 wake-attribution-lib/outcome-landed)))))
                        (catch Exception e (log! "claim-idle-probe-error" role (.getMessage e))))))
                  :on-claim-idle-bounce!
                  (fn [role _fp progress]
                    (log! "claim-progress-bounce" role
                          (claim-progress-lib/format-bounce-log role (:reclaims progress))))
                  :on-claim-idle-halt!
                  (fn [role _fp progress]
                    (halt-for-claim-progress! role progress))}]
    (chase-sweep-lib/run-sweep! (role-inboxes-for-chase roles) now-ms chase-sweep-config adapters)
    (observe-standing-role-loops! roles socket)
    (try
      (observe-standing-role-auth! roles socket)
      (catch Exception e (log! "auth-observe-error" (.getMessage e))))
    (write-chase-status! now-ms)))

;; ── BL-222: dispatch-gap sweep - the daemon's third duty ────────────────────
;; Runs on the SAME cadence as chase-sweep! above (no separate timeout, per
;; the ticket) since it's the daemon (never coordinator self-polling) that
;; already runs unattended. chase_sweep_lib.bb owns the pure decision plus
;; the fixture-testable scanning; everything below is the thin, environment-
;; specific wiring (project paths, the actual subprocess send) that mirrors
;; how chase-sweep!'s adapters wire pure decisions to real tmux/heartbeat.

(defn active-backlog-dir [] (fs/path project-root "backlog" "active"))

;; BL-1097: the state list and the path construction moved into
;; chase_sweep_lib.bb so the coordinator's router reads the SAME directories
;; this sweep does. Two components answering "has this ticket been dispatched?"
;; from different directory sets could disagree, and the disagreement would be
;; silent - so there is one definition, here delegated to.
(defn dispatch-gap-scan-dirs [roles]
  (chase-sweep-lib/dispatch-trail-dirs (vals roles)))

(defn write-scratch-draft! [lines]
  (let [tmp-dir (fs/path daemon-dir "dispatch-gap-drafts")]
    (fs/create-dirs tmp-dir)
    (let [draft (fs/path tmp-dir (str "draft-" (System/nanoTime) ".txt"))]
      (spit (str draft) (str (str/join "\n" lines) "\n"))
      draft)))

(defn swarm-handoff-script []
  (str (fs/path (fs/parent (fs/canonicalize *file*)) "swarm_handoff.bb")))

;; Shells to swarm_handoff.bb (SWARMFORGE_ROLE=coordinator) rather than
;; hand-writing an inbox file, per the ticket's "must go through the normal
;; outbound handoff path" constraint - reuses its full existing validation,
;; sequencing, and atomic outbox write, plus its own sync-delivery attempt.


(defn auto-route! [item]
  (let [commit (or (head-commit-10) "")
        lines (chase-sweep-lib/dispatch-gap-draft-lines item commit)]
    ;; BL-1093: draft-lines returns nil for nobody-assignees (belt-and-braces;
    ;; read-active-items already excludes them from the sweep input).
    (when lines
      (let [draft (write-scratch-draft! lines)
            env (merge (into {} (System/getenv))
                       {"SWARMFORGE_ROLE" "coordinator"
                        task-commit-coherence-gate-lib/dispatch-gap-autoroute-env "1"})
            result (daemon-cycle-guard-lib/sh! ["bb" (swarm-handoff-script) (str draft)] {:dir (str project-root) :env env})]
        (if (zero? (:exit result))
          (log! "dispatch-gap-autoroute" (:id item) (:assigned-to item)
                (if (str/blank? commit) "note-fallback" "git_handoff"))
          (log! "dispatch-gap-autoroute-error" (:id item) (:assigned-to item)
                (task-commit-coherence-gate-lib/operator-refusal-log-line (:err result))))))))

(defn dispatch-gap-sweep! [roles]
  (doseq [item (chase-sweep-lib/dispatch-gap-items (active-backlog-dir) (dispatch-gap-scan-dirs roles))]
    (try
      (auto-route! item)
      (catch Exception e
        (log! "dispatch-gap-autoroute-error" (:id item) (:assigned-to item) (.getMessage e))))))


;; ── Unassigned-active coordinator nudge (sibling of BL-222) ────────────────
;; Does NOT set assigned_to. Drops a note on the coordinator so it assigns
;; and routes. Same SWARMFORGE_ROLE=coordinator outbound path as auto-route!.

(defn nudge-coordinator-unassigned! [item]
  (let [draft (write-scratch-draft! (chase-sweep-lib/unassigned-active-draft-lines item))
        env (merge (into {} (System/getenv)) {"SWARMFORGE_ROLE" "coordinator"})
        result (daemon-cycle-guard-lib/sh! ["bb" (swarm-handoff-script) (str draft)] {:dir (str project-root) :env env})]
    (if (zero? (:exit result))
      (log! "unassigned-active-nudge" (:id item))
      (log! "unassigned-active-nudge-error" (:id item) (str (:err result))))))

(defn unassigned-active-nudge-sweep! [roles]
  (doseq [item (chase-sweep-lib/unassigned-active-items (active-backlog-dir) (dispatch-gap-scan-dirs roles))]
    (try
      (nudge-coordinator-unassigned! item)
      (catch Exception e
        (log! "unassigned-active-nudge-error" (:id item) (.getMessage e))))))


;; ── Open-slot coordinator nudge (sibling of unassigned-active) ──────────────
;; Does NOT promote. Drops a note on the coordinator when active count is
;; under the configured cap and paused/ has eligible work. Pending note in
;; coordinator new/in_process + a short cooldown file prevent spam.

(defn open-slot-cooldown-path []
  (fs/path daemon-dir "open-slot-nudge-cooldown.json"))

(defn read-open-slot-last-sent-ms []
  (let [data (try
               (json/parse-string (slurp (str (open-slot-cooldown-path))) true)
               (catch Exception _ nil))]
    (when (number? (:lastSentMs data)) (:lastSentMs data))))

(defn write-open-slot-last-sent! [now-ms]
  (fs/create-dirs daemon-dir)
  (spit (str (open-slot-cooldown-path))
        (json/generate-string {:lastSentMs now-ms})))

(defn coordinator-pending-dirs [roles]
  (when-let [coord (get roles "coordinator")]
    [(str (handoff-lib/mailbox-dir coord :new))
     (str (handoff-lib/mailbox-dir coord :in_process))]))

(defn nudge-coordinator-open-slot! [candidate]
  (let [draft (write-scratch-draft! (chase-sweep-lib/open-slot-nudge-draft-lines candidate))
        env (merge (into {} (System/getenv)) {"SWARMFORGE_ROLE" "coordinator"})
        result (daemon-cycle-guard-lib/sh! ["bb" (swarm-handoff-script) (str draft)] {:dir (str project-root) :env env})]
    (if (zero? (:exit result))
      (do
        (write-open-slot-last-sent! (System/currentTimeMillis))
        (log! "open-slot-nudge" (:id candidate)))
      (log! "open-slot-nudge-error" (str (:err result))))))

;; BL-798: promotion-inaction escalation — reuses the SAME operator alert
;; channel send-auth-persist-alert! (BL-536) already established (Telegram
;; OPERATOR topic outbox + email via daemon-alarm-lib), notify-only, never
;; halts the swarm.
(defn send-open-slot-escalation-alert! [candidate-id nudge-count]
  (let [reply-outbox (fs/path state-dir "operator" "telegram-reply-outbox.jsonl")
        subject (chase-sweep-lib/open-slot-escalation-email-subject candidate-id)
        tg-text (chase-sweep-lib/open-slot-escalation-telegram-text candidate-id nudge-count)
        reason (chase-sweep-lib/open-slot-escalation-reason candidate-id nudge-count)]
    (log! "open-slot-escalation" candidate-id reason)
    (try
      (fs/create-dirs (fs/parent reply-outbox))
      (spit (str reply-outbox)
            (str (json/generate-string {"threadId" "OPERATOR" "text" tg-text}) "\n")
            :append true)
      (log! "open-slot-escalation-telegram" candidate-id)
      (catch Exception e (log! "open-slot-escalation-telegram-error" (.getMessage e))))
    (try
      (daemon-alarm-lib/send-configured-email!
       project-root conf-file subject reason
       {:already-warned?! (fn [] @escalation-email-missing-key-warned?)
        :log-warning! (fn [msg] (log! "email-misconfigured" msg))
        :mark-warned! (fn [] (reset! escalation-email-missing-key-warned? true))})
      (log! "open-slot-escalation-email" candidate-id)
      (catch Exception e (log! "open-slot-escalation-email-error" (.getMessage e))))))

(defn- open-slot-escalation-threshold []
  (chase-sweep-lib/parse-open-slot-escalation-threshold
   (try (slurp (str (backlog-depth-lib/conf-file-path project-root)))
        (catch Exception _ nil))))

(defn open-slot-nudge-sweep! [roles]
  (try
    (let [active-count (chase-sweep-lib/count-backlog-yaml backlog-active-dir)
          cap (backlog-depth-lib/read-max-depth project-root)
          ;; BL-963: candidate naming, the fire decision's eligible count,
          ;; and escalation tracking all consult the ONE promotion_gates
          ;; evaluate chain (BL-663) - a candidate the chain refuses for
          ;; anything but human_approval as its SOLE refusal is invisible to
          ;; every one of them (bounce D1: a pending+dep-blocked candidate
          ;; reports human_approval first yet is still excluded - the filter
          ;; re-asks the chain with approval satisfied).
          ;; Read/evaluate only when a slot is actually open: done-ids scans
          ;; backlog/done/ recursively, and with capacity closed the decide
          ;; below is false regardless.
          eligible (when (and (number? active-count) (number? cap)
                               (backlog-depth-lib/under-depth-cap? active-count cap))
                     (chase-sweep-lib/nudge-eligible-candidates
                      (chase-sweep-lib/read-paused-candidates backlog-paused-dir)
                      {:active-count active-count
                       :max-depth cap
                       ;; advisory-only in evaluate (never a refusal), so the
                       ;; active-epics scan is skipped here.
                       :active-epics nil
                       :done-ids (promotion-gates-lib/done-ids project-root)}))
          pending-dirs (or (coordinator-pending-dirs roles) [])
          pending? (chase-sweep-lib/open-slot-nudge-pending? pending-dirs)
          now-ms (System/currentTimeMillis)
          cool? (chase-sweep-lib/within-open-slot-cooldown?
                 (read-open-slot-last-sent-ms) now-ms
                 chase-sweep-lib/open-slot-nudge-cooldown-ms)
          ;; BL-679: the promotion freeze - no new item is promoted from
          ;; paused/ while the mode is engaged, so the nudge that would ask
          ;; the coordinator to do exactly that must not fire either.
          ambulance-active? (boolean (:active (ambulance-lib/read-ambulance-state (str project-root))))]
      (when (chase-sweep-lib/decide-open-slot-nudge?
             active-count cap (count eligible)
             {:pending-nudge? pending? :within-cooldown? cool? :ambulance-active? ambulance-active?})
        ;; BL-798: name the top Article-3.2.4 candidate (invariant 1) and
        ;; escalate repeated unacted nudges for the SAME candidate rather
        ;; than repeating a ticketless poke forever (invariant 2). BL-963:
        ;; ranked over the gate-eligible set only.
        (let [candidate (chase-sweep-lib/top-open-slot-candidate
                         eligible (promotion-gates-lib/epic-priority-index project-root))
              decision (chase-sweep-lib/decide-open-slot-escalation
                        @open-slot-escalation-state (:id candidate)
                        (open-slot-escalation-threshold))]
          (reset! open-slot-escalation-state (:state decision))
          (case (:action decision)
            :nudge (nudge-coordinator-open-slot! candidate)
            :escalate (send-open-slot-escalation-alert! (:id candidate) (:count (:state decision)))
            :none nil))))
    (catch Exception e
      (log! "open-slot-nudge-sweep-error" (.getMessage e)))))


;; ── Dropped-parcel coordinator nudge (sibling of BL-222/dispatch-gap) ───────
;; A ticket dispatched once, then dropped mid-pipeline, is invisible to
;; dispatch-gap-sweep! above (which only ever asks "was this EVER
;; dispatched"). Reports to the coordinator only; never routes, assigns, or
;; promotes. Shares dispatch-gap-scan-dirs's exact trail-dir set (BL-222)
;; for has-trail?/newest-trail-ms; live-mail? scopes to :new/:in_process
;; only, across every role (not just the assignee - the parcel may have
;; progressed to, then dropped from, a later stage).

(defn dropped-parcel-live-mail-dirs [roles]
  (vec (for [[_ role-info] roles
             state [:new :in_process]]
         (str (handoff-lib/mailbox-dir role-info state)))))

(defn dropped-parcel-cooldown-path []
  (fs/path daemon-dir "dropped-parcel-nudge-cooldown.json"))

(defn read-dropped-parcel-cooldowns []
  (or (try (json/parse-string (slurp (str (dropped-parcel-cooldown-path))) true)
           (catch Exception _ nil))
      {}))

(defn read-dropped-parcel-last-sent-ms [item-id]
  (get (read-dropped-parcel-cooldowns) (keyword item-id)))

(defn write-dropped-parcel-last-sent! [item-id now-ms]
  (fs/create-dirs daemon-dir)
  (spit (str (dropped-parcel-cooldown-path))
        (json/generate-string (assoc (read-dropped-parcel-cooldowns) (keyword item-id) now-ms))))

(defn nudge-coordinator-dropped-parcel! [item]
  (let [draft (write-scratch-draft! (chase-sweep-lib/dropped-parcel-draft-lines item))
        env (merge (into {} (System/getenv)) {"SWARMFORGE_ROLE" "coordinator"})
        result (daemon-cycle-guard-lib/sh! ["bb" (swarm-handoff-script) (str draft)] {:dir (str project-root) :env env})]
    (if (zero? (:exit result))
      (do
        (write-dropped-parcel-last-sent! (:id item) (System/currentTimeMillis))
        (log! "dropped-parcel-nudge" (:id item)))
      (log! "dropped-parcel-nudge-error" (:id item) (str (:err result))))))

(defn- dropped-parcel-stall-threshold-ms []
  (chase-sweep-lib/parse-dropped-parcel-stall-threshold-ms
   (try (slurp (str (backlog-depth-lib/conf-file-path project-root))) (catch Exception _ nil))))

(defn- dropped-parcel-cooldown-ms []
  (chase-sweep-lib/parse-dropped-parcel-cooldown-ms
   (try (slurp (str (backlog-depth-lib/conf-file-path project-root))) (catch Exception _ nil))))

(defn dropped-parcel-sweep! [roles]
  (try
    (if (master-main-reconcile-lib/deadlock-active?
         (master-main-reconcile-lib/read-deadlock (str daemon-dir)))
      (log! "dropped-parcel-suppressed" "main-sync-deadlock")
      (let [now-ms (System/currentTimeMillis)
            all-dirs (dispatch-gap-scan-dirs roles)
            live-dirs (dropped-parcel-live-mail-dirs roles)
            candidates (chase-sweep-lib/dropped-parcel-items
                        (active-backlog-dir) all-dirs live-dirs now-ms (dropped-parcel-stall-threshold-ms))
            cooldown-ms (dropped-parcel-cooldown-ms)]
        (doseq [item candidates]
          (try
            (when-not (chase-sweep-lib/within-dropped-parcel-cooldown?
                       (read-dropped-parcel-last-sent-ms (:id item)) now-ms cooldown-ms)
              (nudge-coordinator-dropped-parcel! item))
            (catch Exception e
              (log! "dropped-parcel-nudge-error" (:id item) (.getMessage e)))))))
    (catch Exception e
      (log! "dropped-parcel-sweep-error" (.getMessage e)))))


;; ── BL-1104: landed-but-open QA re-notify (sibling of dispatch-gap) ─────────
;; Subject-anchored QA approval on origin/main + still in active/ + no Close
;; → one note to QA asking it to resend the coordinator notify. Never moves
;; backlog files, never closes, never sends the notify on QA's behalf.

(defn nudge-qa-landed-but-open! [item]
  (let [draft (write-scratch-draft! (chase-sweep-lib/landed-but-open-draft-lines item))
        env (merge (into {} (System/getenv)) {"SWARMFORGE_ROLE" "coordinator"})
        result (daemon-cycle-guard-lib/sh! ["bb" (swarm-handoff-script) (str draft)] {:dir (str project-root) :env env})]
    (if (zero? (:exit result))
      (log! "landed-but-open-nudge" (:id item) (:approval-commit item))
      (log! "landed-but-open-nudge-error" (:id item) (str (:err result))))))

(defn landed-but-open-sweep! [roles]
  (try
    (let [git-ref (chase-sweep-lib/resolve-landed-main-ref (str project-root))
          commits (chase-sweep-lib/read-ref-subject-commits (str project-root) git-ref)
          scan-dirs (dispatch-gap-scan-dirs roles)
          items (chase-sweep-lib/landed-but-open-items
                 (active-backlog-dir) commits scan-dirs)]
      ;; Always one named boundary detail (action or none) — diagnosable without re-run.
      (log! "landed-but-open" (chase-sweep-lib/landed-but-open-boundary-detail items))
      (doseq [item items]
        (try
          (nudge-qa-landed-but-open! item)
          (catch Exception e
            (log! "landed-but-open-nudge-error" (:id item) (.getMessage e))))))
    (catch Exception e
      (log! "landed-but-open-error" (.getMessage e)))))


;; ── BL-678: batch-claim-progress suspect nudge (live-owner half of ─────────
;; BL-648's source near-miss) ─────────────────────────────────────────────────
;; Scoped to :receive-mode "batch" roles only (cleaner/hardender today) -
;; task-mode claims are BL-528's territory (.claim-progress.json above),
;; untouched. Never re-forwards or re-delivers a parcel; the only action is
;; a coordinator-facing suspect note, same posture as dropped-parcel-sweep!.

(defn batch-claim-progress-cooldown-path []
  (fs/path daemon-dir "batch-claim-progress-suspect-cooldown.json"))

(defn read-batch-claim-progress-cooldowns []
  (or (try (json/parse-string (slurp (str (batch-claim-progress-cooldown-path))) true)
           (catch Exception _ nil))
      {}))

(defn read-batch-claim-progress-last-sent-ms [file-path]
  (get (read-batch-claim-progress-cooldowns) (keyword (fs/file-name file-path))))

(defn write-batch-claim-progress-last-sent! [file-path now-ms]
  (fs/create-dirs daemon-dir)
  (spit (str (batch-claim-progress-cooldown-path))
        (json/generate-string (assoc (read-batch-claim-progress-cooldowns) (keyword (fs/file-name file-path)) now-ms))))

(defn nudge-coordinator-batch-claim-suspect! [suspect]
  (let [draft (write-scratch-draft!
               (chase-sweep-lib/batch-claim-progress-suspect-draft-lines (:item-id suspect) (:age-ms suspect)))
        env (merge (into {} (System/getenv)) {"SWARMFORGE_ROLE" "coordinator"})
        result (daemon-cycle-guard-lib/sh! ["bb" (swarm-handoff-script) (str draft)] {:dir (str project-root) :env env})]
    (if (zero? (:exit result))
      (do
        (write-batch-claim-progress-last-sent! (:file-path suspect) (System/currentTimeMillis))
        (log! "batch-claim-progress-suspect" (:item-id suspect)))
      (log! "batch-claim-progress-suspect-error" (:item-id suspect) (str (:err result))))))

(defn- batch-claim-progress-stale-threshold-ms []
  (chase-sweep-lib/parse-batch-claim-progress-stale-threshold-ms
   (try (slurp (str (backlog-depth-lib/conf-file-path project-root))) (catch Exception _ nil))))

;; BL-1076: operator per-role overrides, read alongside the base above.
(defn- batch-claim-progress-role-stale-thresholds-ms []
  (chase-sweep-lib/parse-batch-claim-progress-role-stale-threshold-ms
   (try (slurp (str (backlog-depth-lib/conf-file-path project-root))) (catch Exception _ nil))))

(defn- batch-claim-progress-cooldown-ms []
  (chase-sweep-lib/parse-batch-claim-progress-cooldown-ms
   (try (slurp (str (backlog-depth-lib/conf-file-path project-root))) (catch Exception _ nil))))

(defn batch-claim-progress-sweep! [roles]
  (try
    (let [now-ms (System/currentTimeMillis)
          base-stale-ms (batch-claim-progress-stale-threshold-ms)
          role-overrides (batch-claim-progress-role-stale-thresholds-ms)
          cooldown-ms (batch-claim-progress-cooldown-ms)]
      (doseq [[role role-info] roles
              :when (= "batch" (:receive-mode role-info))]
        (try
          ;; BL-1076: the threshold is resolved PER ROLE, and the owner's
          ;; uncommitted work is a second progress signal beside HEAD. A
          ;; hardener mid-Stryker moves neither HEAD nor the clock for an hour
          ;; and is working the whole time.
          (let [in-process-dir (str (handoff-lib/mailbox-dir role-info :in_process))
                items (chase-sweep-lib/scan-in-process in-process-dir)
                current-commit (worktree-head-commit-10 roles role)
                stale-ms (batch-claim-progress-lib/resolve-stale-threshold-ms
                          role base-stale-ms role-overrides)
                dirty? (role-worktree-dirty? roles role)
                {:keys [suspects suppressed]}
                (chase-sweep-lib/apply-batch-claim-progress-check!
                 items now-ms stale-ms current-commit dirty?)]
            (doseq [suspect suspects]
              (when-not (chase-sweep-lib/within-dropped-parcel-cooldown?
                         (read-batch-claim-progress-last-sent-ms (:file-path suspect)) now-ms cooldown-ms)
                (nudge-coordinator-batch-claim-suspect! suspect)))
            ;; Invariant 2: no suppression is silent. Logged unconditionally,
            ;; with no cooldown - a worktree that stays dirty forever must read
            ;; as a SUPPRESSED signal in the record, never as an absent one.
            (doseq [item suppressed]
              (log! "batch-claim-progress-suppressed" (:item-id item) (:reason item)
                    (str (quot (:age-ms item) 60000) "m"))))
          (catch Exception e
            (log! "batch-claim-progress-sweep-role-error" role (.getMessage e))))))
    (catch Exception e
      (log! "batch-claim-progress-sweep-error" (.getMessage e)))))


;; ── BL-577: flow watchdog sweep - every mailbox, any parcel type ────────────
;; Unsuppressable by design (the ticket's own requirement): this sweep emits
;; NO tmux wake, only a durable Telegram OPERATOR-topic alarm, so it runs
;; unconditionally alongside briefing-email-sweep! below - never gated behind
;; outbound-wakes-suppressed? (that gate exists for wakes/pokes, not for a
;; read-only flow-stall alarm the human needs regardless of any pause).
;; flow_watchdog_lib.bb owns the pure tier/verb decisions and durable state
;; (fixture-tested); this is the thin, environment-specific wiring - role
;; enumeration via handoff-lib/mailbox-dir (BL-128, covers master-resident
;; AND worktree mailboxes) and the same telegram-reply-outbox.jsonl the
;; endless-loop/claim-progress halts above already append to.

(defn role-inboxes-for-flow-watchdog [roles]
  (vec (for [[role role-info] roles]
         {:role role
          :new-dir (handoff-lib/mailbox-dir role-info :new)
          :in-process-dir (handoff-lib/mailbox-dir role-info :in_process)
          :completed-dir (handoff-lib/mailbox-dir role-info :completed)
          :abandoned-dir (handoff-lib/mailbox-dir role-info :abandoned)})))

(defn flow-watchdog-live-session? [roles socket role]
  (boolean
   (when-let [session (:session (get roles role))]
     (handoff-lib/session-exists? socket session))))

(defn flow-watchdog-emit-alarm!
  "Returns true on a CONFIRMED outbox write, false on failure - run-sweep!
   (BL-577 bounce fix) only persists a parcel's alarmed state on a truthy
   return, so a failed write here is retried next sweep rather than
   silently treated as sent. Logs the alarm BEFORE attempting the outbox
   write (matching endless-loop-halt's ordering) so a log backstop of the
   alarm survives even when the write itself fails."
  [text]
  (log! "flow-watchdog-alarm" text)
  (let [reply-outbox (fs/path state-dir "operator" "telegram-reply-outbox.jsonl")]
    (try
      (fs/create-dirs (fs/parent reply-outbox))
      (spit (str reply-outbox)
            (str (json/generate-string {"threadId" "OPERATOR" "text" text}) "\n")
            :append true)
      true
      (catch Exception e
        (log! "flow-watchdog-telegram-error" (.getMessage e))
        false))))

(defn flow-watchdog-provider-outage-evidence-for
  "BL-840: resolves role -> its configured provider (:agent - the same
   BL-208 lookup :log-telemetry! above uses) and reads that provider's
   recorded evidence lines. A role with no configured provider gets no
   evidence, never a guess. Read failures already degrade to [] inside
   provider-outage-evidence-lib itself (invariant 1) - no try/catch needed
   here."
  [roles role]
  (if-let [provider (:agent (get roles role))]
    (provider-outage-evidence-lib/evidence-for-provider (str state-dir) provider)
    []))

(defn flow-watchdog-sweep! [roles socket]
  (flow-watchdog-lib/run-sweep!
   (role-inboxes-for-flow-watchdog roles)
   (System/currentTimeMillis)
   (str project-root)
   daemon-dir
   {:live-session? (fn [role] (flow-watchdog-live-session? roles socket role))
    :emit-alarm! flow-watchdog-emit-alarm!
    :provider-outage-evidence-for (fn [role] (flow-watchdog-provider-outage-evidence-for roles role))}))

(defn role-info-by-name [roles seat]
  (some #(when (= (:role %) seat) %) roles))


;; ── BL-679 piece 3: ambulance auto-exit sweep - shares the chase-sweep
;;    cadence, runs UNCONDITIONALLY (same rationale as flow-watchdog-sweep!/
;;    master-checkout-drift-sweep! above): invariant 2 ("no marker state can
;;    leave the swarm holding everything with nothing able to move") must
;;    hold even while an unrelated pause suppresses outbound wakes - an
;;    already-delivered-or-abandoned ambulance ticket must still release,
;;    never wait out a pause it has nothing to do with. Thin wrapper only:
;;    ambulance-lib/auto-exit! owns the real read/classify/release decision
;;    (fs-only, no daemon dependency, directly unit/property-testable); this
;;    adds the two genuinely impure duties a real sweep needs - the daemon
;;    log line, and the release announcement over the SAME durable Telegram
;;    OPERATOR-topic outbox every other unsuppressable alarm in this cadence
;;    writes to (flow-watchdog-emit-alarm!) - and never touches engage!.
(defn ambulance-auto-exit-sweep! []
  (try
    (when-let [{:keys [ticket case]} (ambulance-lib/auto-exit! (str project-root))]
      (let [queued (chase-sweep-lib/top-expedited-paused-candidate
                    (chase-sweep-lib/read-paused-candidates backlog-paused-dir)
                    (promotion-gates-lib/epic-priority-index project-root))
            text (ambulance-lib/auto-exit-announcement-text
                  {:ticket ticket :case case :queued-expedited-defect-id queued})]
        (log! "ambulance-auto-exit" ticket (name case))
        (flow-watchdog-emit-alarm! text)))
    (catch Exception e
      (log! "ambulance-auto-exit-sweep-error" (.getMessage e)))))


;; ── BL-839: master-checkout-vs-main drift sweep - report only ──────────────
;; The daemon executes THIS checkout's working tree, not a committed ref
;; (see master_checkout_drift_lib.bb's own header for the incident this
;; guards against). Reuses flow-watchdog-emit-alarm! - the same durable
;; Telegram OPERATOR-topic outbox every other unsuppressable alarm in this
;; sweep block writes to - so this needs no new alerting channel.
;; BL-1139: durable drift auto-repairs via repair-master-checkout-drift!
;; (check-master-checkout-drift! stays write-free).

(defn- defer-handoffd-bounce-after-drift-repair! []
  ;; BL-1139: bounce after this sweep tick finishes (deferred).
  (let [launcher (str (fs/path (fs/parent (fs/canonicalize *file*)) "start_handoff_daemon.sh"))
        root (str project-root)]
    (.start
     (Thread.
      (fn []
        (try
          (Thread/sleep 2000)
          (daemon-cycle-guard-lib/sh! ["bash" launcher root])
          (catch Exception e
            (log! "master-checkout-drift-bounce-error" (.getMessage e)))))))))

(defn master-checkout-drift-sweep! []
  ;; BL-1139: repair durable daemon-script drift (check stays write-free).
  (master-checkout-drift-lib/repair-master-checkout-drift!
   {:project-root (str project-root)
    :emit-alarm! flow-watchdog-emit-alarm!
    :emit-restored! flow-watchdog-emit-alarm!
    :bounce-handoffd! defer-handoffd-bounce-after-drift-repair!}))
;; BL-1123: bare=true / collapsed-tip guard — heal bare, alarm on tiny HEAD.
(defn master-checkout-integrity-sweep! []
  (master-checkout-integrity-lib/run-master-checkout-integrity!
   {:project-root (str project-root)
    :emit-alarm! flow-watchdog-emit-alarm!}))



;; ── BL-214: briefing-email sweep - the daemon's fourth duty ─────────────────
;; Runs on the SAME cadence as chase-sweep!/dispatch-gap-sweep! above (no
;; separate timeout) since this daemon already runs unattended regardless of
;; whether the VS Code host is open. briefing_email_lib.bb owns the pure
;; scanning/marker/subject logic (fixture-tested); this is the thin,
;; environment-specific wiring - reusing daemon_alarm_lib.bb's
;; send-configured-email! exactly as handoffd_supervisor.bb's BL-144 alarm
;; does, so there is still only ONE Resend client in the whole swarm, and a
;; configured-but-keyless setup warns loudly here too (BL-215), not just for
;; the death alarm.

;; One-shot per process, same rationale as handoffd_supervisor.bb's own
;; missing-key-warned? - a separate atom because this is a separate process.
(def briefing-missing-key-warned? (atom false))

;; BL-260: the 3-arg form threads an optional html body (the rendered-
;; diagrams section) through to send-configured-email!'s new 5-arg form; the
;; 2-arg form is unchanged (html nil), matching daemon-alarm-lib's own
;; additive, backward-compatible arity pattern.
;;
;; BL-286: the 4-arg form additionally threads an optional attachments seq
;; (the diagram section's cid inline attachments) through to
;; send-configured-email!'s new 6-arg form; the 3-arg form delegates to it
;; with attachments nil, so every pre-BL-286 caller keeps its exact prior
;; behavior.
(defn send-configured-briefing-email!
  ([subject text] (send-configured-briefing-email! subject text nil))
  ([subject text html] (send-configured-briefing-email! subject text html nil))
  ([subject text html attachments]
   (daemon-alarm-lib/send-configured-email!
    project-root conf-file subject text html attachments
    {:already-warned?! (fn [] @briefing-missing-key-warned?)
     :log-warning! (fn [msg] (log! "email-misconfigured" msg))
     :mark-warned! (fn [] (reset! briefing-missing-key-warned? true))})))

;; BL-902: the SAME to/api-key resolution send-configured-briefing-email!
;; above performs, but decides sendability alone - no compose, no send -
;; so briefing-email-sweep! can skip the entire expensive gather+render
;; when the email cannot go out anyway (the ~96s-per-cycle stall this
;; ticket exists to fix). Fires the SAME one-shot warn-missing-key-if-
;; needed! atom/log line as the real send path when the reason is
;; :missing-api-key, so a caller consulting this instead of actually
;; sending still gets the loud, deduped warning exactly as before.
(defn briefing-send-reason! []
  (let [reason (daemon-alarm-lib/configured-email-send-reason conf-file)]
    (when (= reason :missing-api-key)
      (daemon-alarm-lib/warn-missing-key-if-needed!
       {:reason reason}
       {:already-warned?! (fn [] @briefing-missing-key-warned?)
        :log-warning! (fn [msg] (log! "email-misconfigured" msg))
        :mark-warned! (fn [] (reset! briefing-missing-key-warned? true))}))
    reason))

;; BL-976: one-shot per GENERATION Telegram alert when notify_email_to is
;; configured but this generation's environment has no RESEND_API_KEY. The
;; email-misconfigured log line above is invisible to an operator who is
;; not reading the log - the defect was a silent keyless generation whose
;; only symptom was a briefing that never arrived. Swept on the shared
;; cadence UNCONDITIONALLY (not only when a briefing is mailable) so the
;; alert lands within the generation's FIRST sweep cycle regardless of
;; pending briefings. The atom is per-process = per daemon generation,
;; same rationale as briefing-missing-key-warned? above - and marked only
;; after a successful outbox write (alert-keyless-if-needed!'s contract),
;; so a transport hiccup retries next cycle instead of silently counting
;; as delivered. daemon_alarm_lib.bb owns the pure decision + text; this
;; is the environment-specific transport wiring only (the same
;; OPERATOR-topic outbox every other operator alert in this file uses -
;; the bridge polls telegram-reply-outbox.jsonl).
(def email-keyless-alerted? (atom false))

(def operator-daemon-env-file
  (str (fs/path project-root ".swarmforge" "operator" "daemon.env")))

(defn email-keyless-alert-sweep! []
  (daemon-alarm-lib/alert-keyless-if-needed!
   (daemon-alarm-lib/configured-email-send-reason conf-file)
   {:already-alerted?! (fn [] @email-keyless-alerted?)
    :send-alert!
    (fn []
      (let [reply-outbox (fs/path state-dir "operator" "telegram-reply-outbox.jsonl")
            tg-text (daemon-alarm-lib/format-keyless-alert operator-daemon-env-file)]
        (fs/create-dirs (fs/parent reply-outbox))
        (spit (str reply-outbox)
              (str (json/generate-string {"threadId" "OPERATOR" "text" tg-text}) "\n")
              :append true)
        (log! "email-keyless-alert" operator-daemon-env-file)))
    :mark-alerted! (fn [] (reset! email-keyless-alerted? true))}))

;; BL-967 cleaner pass: "shell out to a compiled node tool under
;; extension/out/tools and take its trimmed stdout" was hand-copied across
;; nine briefing fns, each carrying a comment saying "same shell-out pattern
;; as <sibling> above" - the duplication was being DOCUMENTED rather than
;; removed, and the tools directory itself was spelled out at twenty call
;; sites. Two definitions instead: WHERE the compiled tools live, and the
;; degrade-never-crash contract every caller depends on (nil on a non-zero
;; exit or any failure - CLI not yet compiled on this checkout, etc. - so
;; the line is omitted, never fabricated, and the sweep never crashes).
(defn node-tool-path [script-name]
  (str (fs/path project-root "extension" "out" "tools" script-name)))

;; The [cmd & args] + opts-map form of the shared sh! helper is mandatory
;; here, not flat varargs - the latter silently drops :dir (see auto-route!'s
;; own comment above). The hazard lives at THIS single call site now: every
;; briefing line below shells through this fn and nowhere else.
(defn node-tool-line
  "Trimmed stdout of a compiled node tool, or nil on any failure."
  [script-name & args]
  (try
    (let [{:keys [exit out]} (daemon-cycle-guard-lib/sh!
                              (into ["node" (node-tool-path script-name)] args)
                              {:dir (str project-root)})]
      (when (zero? exit) (str/trim out)))
    (catch Exception _ nil)))

;; BL-252: shells to the compiled suite-duration-line.js CLI (Babashka has
;; no way to import compiled TS) - reuses computeSuiteDurationTrend/
;; computeSuiteDuration unchanged, the SAME functions already feeding the
;; bridge's /metrics route the holistic UI reads, so the briefing can never
;; disagree with the live UI about what "regressing" means. Any failure
;; (CLI not yet compiled on this checkout, etc.) degrades to omitting the
;; line entirely - never crashes the sweep, never a fabricated value.
(defn suite-duration-briefing-line []
  (node-tool-line "suite-duration-line.js"))

;; BL-251: same shell-out pattern as suite-duration-briefing-line above -
;; reuses computeBacklogDashboard's own needsApproval field unchanged, the
;; SAME field backlog.json/the PWA already carry, so the briefing can never
;; disagree with the PWA about what's pending. Any failure degrades to
;; omitting the section entirely - never crashes the sweep.
(defn needs-approval-briefing-section []
  (node-tool-line "needs-approval-line.js"))

;; BL-256: same shell-out pattern as suite-duration-briefing-line/
;; needs-approval-briefing-section above - each CLI reuses existing
;; telemetry unchanged (gitHistoryAdapter.ts + ticketHoldingWindows.ts,
;; stageDwell.ts's own already-shipped stage-dwell-report.js CLI as-is, and
;; swarmMetrics.ts's chaser telemetry), so the briefing can never disagree
;; with the live UI/CLI about what these numbers are. Any failure degrades
;; to omitting the section entirely - never crashes the sweep.
(defn merged-blocked-digest-briefing-section []
  (node-tool-line "briefing-digest-line.js" "--snapshot" lifecycle-snapshot-path))

;; Reuses BL-102's own stage-dwell-report.js CLI directly (no new wrapper
;; needed - its default text output is already briefing-ready).
(defn stage-dwell-briefing-section []
  (node-tool-line "stage-dwell-report.js"))

(defn chase-trend-briefing-section []
  (node-tool-line "chase-trend-line.js"))

;; BL-263: same shell-out pattern as needs-approval-briefing-section above -
;; reuses computeBacklogDashboard's own notDoneCount field unchanged, the
;; SAME field backlog.json/the PWA already carry, so the briefing can never
;; disagree with the PWA about the not-done total. Any failure degrades to
;; omitting the line entirely - never crashes the sweep.
(defn not-done-count-briefing-line []
  (node-tool-line "not-done-count-line.js"))

;; BL-337: pure Babashka text-parsing, no compiled TS needed - unlike the
;; *-briefing-line fns above, this reads standing_rule_violations_lib.bb's
;; own scan directly (constitution articles + role prompts), never
;; shelling to node. Any failure (a file unreadable, an unexpected repo
;; layout) degrades to omitting the line entirely - never crashes the
;; sweep, never fabricates a count. File discovery itself is shared with
;; standing_rule_violations_cli.bb via standing_rule_violations_files.bb -
;; both used to carry their own copy of this filter, with the same bug.
;; BL-431: shells to the compiled suboptimality-verdict-line.js CLI (same
;; shell-out pattern as the *-briefing-line fns above) - reuses BL-430's
;; persisted rework-rate signal and reworkDiagnosis.ts's pure verdict logic
;; unchanged. The CLI itself already prints nothing (empty stdout) when
;; there is no signal yet or the rate is at/below baseline, so `str/trim
;; out` naturally degrades to a blank block (no briefing noise) in that
;; case, same as every sibling section here; any other failure (CLI not
;; yet compiled, etc.) degrades identically - never crashes the sweep.
(defn suboptimality-verdict-briefing-line []
  (node-tool-line "suboptimality-verdict-line.js"))

;; BL-454: shells to the compiled qa-bounce-line.js CLI, same shell-out
;; pattern as the *-briefing-line fns above, fed by the durable bounce log
;; record-bounce.js (the go-forward writer, BL-635 - any reviewing role, not
;; only QA) and backfill-qa-bounces.js (the one-time seed from the evidence
;; corpus) write, so the briefing can never disagree with either. The CLI
;; itself prints nothing (empty stdout) when there are no recorded bounces
;; yet, so `str/trim out` naturally degrades to a blank block (no briefing
;; noise) in that case, same as every sibling section here; any other
;; failure (CLI not yet compiled, etc.) degrades identically - never crashes
;; the sweep.
(defn qa-bounce-briefing-line []
  (node-tool-line "qa-bounce-line.js"))

;; BL-511: shells to the compiled telegram-bridge-cost-line.js CLI, same
;; shell-out pattern as the *-briefing-line fns above - reuses
;; computeTelegramBridgeCostForDay/formatTelegramBridgeCostLine unchanged,
;; fed by the durable bridge-cost log operator_lib.bb's
;; front-desk-cost-record appends at reap time (operator_runtime.bb). The
;; CLI itself prints nothing (empty stdout) when the day has no records at
;; all, so `str/trim out` naturally degrades to a blank block (no briefing
;; noise) in that case, same as every sibling section here; any other
;; failure (CLI not yet compiled, etc.) degrades identically - never
;; crashes the sweep. No day-key arg is passed - the CLI defaults to real
;; UTC-today in production (a test fixes it via an explicit arg instead).
(defn telegram-bridge-cost-briefing-line []
  (node-tool-line "telegram-bridge-cost-line.js"))

;; BL-619: shells to the compiled token-burn-section.js CLI, same shell-out
;; pattern as the *-briefing-line fns above, but the CLI's stdout is JSON
;; (kind/leadingText/appendedText/subjectMarker/warning) rather than a
;; single text line - it composes both the leading warning AND the appended
;; ok/no-anchor/malformed one-liner, only one of which is ever populated per
;; call, so this needs the full shape rather than a trimmed string. Any
;; failure (CLI not yet compiled, non-zero exit) degrades to nil, same as
;; every sibling CLI here - never crashes the sweep, never fabricates a
;; percentage. A malformed reset config (malformed-reset-config-08) carries
;; a non-nil :warning, logged loudly here in addition to the CLI's own
;; stderr write - the daemon's own persisted log is the actually-monitored
;; surface, not an interactive terminal.
(defn token-burn-briefing-section []
  (try
    (let [cli-path (node-tool-path "token-burn-section.js")
          {:keys [exit out]} (daemon-cycle-guard-lib/sh! ["node" cli-path] {:dir (str project-root)})]
      (when (zero? exit)
        (let [{:keys [leadingText appendedText subjectMarker warning]} (json/parse-string out true)]
          (when warning
            (log! "token-burn-section-malformed-config" warning))
          {:leading-text leadingText :appended-text appendedText :subject-marker? subjectMarker})))
    (catch Exception _ nil)))

(defn standing-rule-violations-briefing-line []
  (try
    (let [files (for [f (standing-rule-violations-files/rule-source-files project-root)]
                  {:path (str (fs/relativize (fs/path project-root) f)) :content (slurp (str f))})
          violations (standing-rule-violations-lib/scan-violations files)
          total (standing-rule-violations-lib/total-citation-count violations)]
      (when (pos? total)
        (str "Standing-rule violations: " total " cited recurrence(s) across "
             (count violations) " rule(s) since they landed (top: "
             (str/join ", " (map (fn [{:keys [rule count]}] (str "\"" rule "\" x" count))
                                  (take 3 violations)))
             ").")))
    (catch Exception _ nil)))

;; BL-260: same shell-out pattern as the *-briefing-section fns above, but
;; the CLI's stdout is JSON ([{:name :base64}...] - the rendered diagrams),
;; not a single text line, so this parses it instead of trimming it. Any
;; failure (renderer dependency missing, an .mmd parse error, the CLI not
;; yet compiled on this checkout) degrades to nil, same as every sibling
;; CLI here - never crashes the sweep.
(defn briefing-diagrams-json []
  (try
    (let [cli-path (node-tool-path "render-briefing-diagrams.js")
          {:keys [exit out]} (daemon-cycle-guard-lib/sh! ["node" cli-path] {:dir (str project-root)})]
      (when (zero? exit) (json/parse-string out true)))
    (catch Exception _ nil)))

;; Not-done ticket burndown chart - same JSON [{name base64}] contract as
;; briefing-diagrams-json, independent shell-out so a burndown failure
;; never suppresses architecture diagrams (and vice versa).
(defn briefing-burndown-json []
  (try
    (let [cli-path (node-tool-path "render-briefing-burndown.js")
          {:keys [exit out]} (daemon-cycle-guard-lib/sh! ["node" cli-path "--snapshot" lifecycle-snapshot-path] {:dir (str project-root)})]
      (when (zero? exit) (json/parse-string out true)))
    (catch Exception _ nil)))

;; Wraps architecture + not-done burndown renders with briefing_email_lib.bb's
;; pure diagram-section-from-sources (BL-896 F4: previously build-diagram-
;; section directly - this combining step, which is what actually makes the
;; "each source fails open independently" claim below true, had nothing a
;; unit test could exercise in isolation until it moved into the lib file
;; alongside build-diagram-section, testable the same way). BL-260
;; render-unavailable-degradation-04: nil/empty still produce a clear
;; no-diagram note, never a crash. Each source fails open independently;
;; whichever succeeds still ships.
(defn briefing-diagram-section []
  (briefing-email-lib/diagram-section-from-sources briefing-diagrams-json briefing-burndown-json))

(defn briefing-email-sweep! []
  (briefing-email-lib/send-unsent-briefings!
   (str briefings-dir)
   {:send-reason! briefing-send-reason!
    :today-str (str (java.time.LocalDate/now java.time.ZoneOffset/UTC))
    :commit-marker! briefing-email-lib/commit-sent-marker!
    :read-briefing-content (fn [file-name] (slurp (str (fs/path briefings-dir file-name))))
    :send-email! send-configured-briefing-email!
    :diagram-section briefing-diagram-section
    :suite-duration-line suite-duration-briefing-line
    :needs-approval-section needs-approval-briefing-section
    :merged-blocked-digest merged-blocked-digest-briefing-section
    :stage-dwell-section stage-dwell-briefing-section
    :chase-trend-section chase-trend-briefing-section
    :not-done-count-line not-done-count-briefing-line
    :standing-rule-violations-line standing-rule-violations-briefing-line
    :suboptimality-verdict-line suboptimality-verdict-briefing-line
    :qa-bounce-line qa-bounce-briefing-line
    :telegram-bridge-cost-line telegram-bridge-cost-briefing-line
    :token-burn-section token-burn-briefing-section
    :log! (fn [& parts] (apply log! parts))}))

;; BL-353: shells to the compiled notify-dead-letters.js CLI, same posture
;; as the other *-sweep! adapters below - ports the retired legacy narrator's
;; "dead-letter" signal (telegramNarrator.ts:diffNewDeadLetters) onto the
;; headless front desk, into BL-346's reserved Operator topic (a dead
;; letter is not reliably ticket-scoped, unlike a NeedsApproval gate). The
;; CLI itself owns the growing-set announced state and delivery-based
;; arming; this adapter only owns invoking it.
(defn dead-letter-notify-sweep! []
  (try
    (let [cli-path (node-tool-path "notify-dead-letters.js")
          {:keys [exit out]} (daemon-cycle-guard-lib/sh! ["node" cli-path] {:dir (str project-root)})]
      (when (zero? exit)
        (log! "dead-letter-notify" (str/trim out))))
    (catch Exception e
      (log! "dead-letter-notify-sweep-error" (.getMessage e)))))

;; BL-350 (BL-336 finding H1): shells to the compiled sample-resources.js
;; CLI, same posture as dead-letter-notify-sweep! above - reuses BL-264's
;; startResourceSampler pid-resolution/append path
;; unchanged, so a swarm running headless (no editor attached) finally
;; produces the resource_sample telemetry the cost-health sidecar's
;; resourceAnomalies field has depended on since BL-213 and never received.
;; The CLI itself owns the "is a sample already due" gate
;; (shouldSampleThisInterval against the shared telemetry file) - firing
;; this sweep every cycle like its siblings is safe, since most invocations
;; no-op until the interval elapses, and an editor's own host-side sampler
;; recording a sample makes THIS sweep's own next tick no-op too (shared
;; gate, not two independently-tuned timers).
(defn resource-sample-sweep! []
  (try
    (let [cli-path (node-tool-path "sample-resources.js")
          {:keys [exit out]} (daemon-cycle-guard-lib/sh! ["node" cli-path] {:dir (str project-root)})]
      (when (zero? exit)
        (log! "resource-sample" (str/trim out))))
    (catch Exception e
      (log! "resource-sample-sweep-error" (.getMessage e)))))

;; BL-665: shells to the compiled run-context-telemetry-producer.js CLI —
;; walks role transcripts via BL-664's transcriptWalker and fills GH-22's
;; context-events store through context_telemetry_cli.bb record. Idempotent
;; within a tick and across reruns (agent+session_id+timestamp dedupe), so
;; firing every cycle like sibling sweeps is safe.
(defn context-telemetry-producer-sweep! []
  (try
    (let [cli-path (node-tool-path "run-context-telemetry-producer.js")
          {:keys [exit out]} (daemon-cycle-guard-lib/sh! ["node" cli-path] {:dir (str project-root)})]
      (when (zero? exit)
        (log! "context-telemetry-producer" (str/trim out))))
    (catch Exception e
      (log! "context-telemetry-producer-sweep-error" (.getMessage e)))))

;; BL-356: twice in one day local `main` accumulated hours of committed work
;; that never reached origin, indistinguishable from a dead swarm from
;; outside - nothing in the swarm ever pushed; publication depended
;; entirely on an LLM role remembering to run `git push`. Runs on the same
;; cadence as the sweeps above (no separate timeout). push_sweep_lib.bb
;; owns the pure decision/state logic (ahead/behind classification,
;; bounded push-retry backoff, delivery-based alarm arming); this is the
;; thin git/network-specific wiring, mirroring stuck-escalation-email-
;; sweep!'s own posture and reusing the SAME daemon_alarm_lib.bb sender.
(def push-sweep-retry-config
  {:max-push-attempts (env-ms "PUSH_SWEEP_MAX_PUSH_ATTEMPTS" 5)
   :max-alarm-attempts (env-ms "PUSH_SWEEP_MAX_ALARM_ATTEMPTS" 3)
   :backoff-base-ms (env-ms "PUSH_SWEEP_BACKOFF_BASE_MS" 30000)
   :backoff-max-ms (env-ms "PUSH_SWEEP_BACKOFF_MAX_MS" 300000)})

;; One-shot per process, same rationale as escalation-email-missing-key-
;; warned?/briefing-missing-key-warned? above - a separate atom because
;; this is a separate signal.
(def push-alarm-email-missing-key-warned? (atom false))

;; BL-356 E2E test seam, mirroring send-escalation-alarm-email!'s own
;; ESCALATION_ALARM_FORCE_RESULT convention exactly: when set, short-
;; circuits the real send entirely and returns this JSON-decoded result
;; instead. Never set in production.
(defn send-push-alarm-email! [subject text]
  (if-let [forced (System/getenv "PUSH_ALARM_FORCE_RESULT")]
    (json/parse-string forced true)
    (daemon-alarm-lib/send-configured-email!
     project-root conf-file subject text
     {:already-warned?! (fn [] @push-alarm-email-missing-key-warned?)
      :log-warning! (fn [msg] (log! "email-misconfigured" msg))
      :mark-warned! (fn [] (reset! push-alarm-email-missing-key-warned? true))})))

(defn- git-fetch-origin-main! []
  (try
    (daemon-cycle-guard-lib/sh! ["git" "fetch" "origin" "main"] {:dir (str project-root)})
    (catch Exception e
      (log! "push-sweep-fetch-error" (.getMessage e)))))

;; A fetch failure is logged and swallowed, not treated as "up to date" -
;; the rev-list below still runs against whatever origin/main ref is
;; already cached locally (from a prior successful fetch), so `ahead`
;; (local's own unpublished work) stays accurate even when THIS tick's
;; fetch failed; a stale view of `behind` self-corrects on the next
;; successful fetch, and in the meantime a plain push against a truly
;; advanced origin simply fails and is retried like any other transient
;; failure - it is never force-pushed.
(defn push-sweep-rev-counts! []
  (git-fetch-origin-main!)
  (let [{:keys [exit out]} (daemon-cycle-guard-lib/sh! ["git" "rev-list" "--left-right" "--count" "origin/main...main"]
                                        {:dir (str project-root)})]
    (if (zero? exit)
      (let [[behind ahead] (map parse-long (str/split (str/trim out) #"\s+"))]
        {:ahead (or ahead 0) :behind (or behind 0)})
      (do
        (log! "push-sweep-revcount-error" (str/trim out))
        {:ahead 0 :behind 0}))))

;; Never --force: a rejected (non-fast-forward) push surfaces as a plain
;; failed exit here, which push_sweep_lib.bb's own bounded retry treats
;; like any other transient failure - true divergence is caught BEFORE a
;; push is ever attempted, by push-sweep-rev-counts! above.
(defn push-sweep-push! []
  (let [{:keys [exit err]} (daemon-cycle-guard-lib/sh! ["git" "push" "origin" "main"] {:dir (str project-root)})]
    (if (zero? exit)
      {:success true}
      {:success false :error (str/trim (or err ""))})))

;; BL-630: the real git/CLI-specific wiring for push_sweep_lib.bb's own
;; qa-gate-decision - pure decision logic stays there, this is only the
;; git-shelling adapter (mirrors this file's own push-sweep-rev-counts!
;; posture). Called ONLY from within push_sweep_lib.bb's :should-push
;; branch, so origin/main is already freshly fetched this tick (by
;; push-sweep-rev-counts! above, which always runs first).
(defn- git-ref-exists? [ref]
  (zero? (:exit (daemon-cycle-guard-lib/sh! ["git" "rev-parse" "--verify" "-q" ref] {:dir (str project-root)}))))

(defn- git-rev-parse [ref]
  (let [{:keys [exit out]} (daemon-cycle-guard-lib/sh! ["git" "rev-parse" ref] {:dir (str project-root)})]
    (when (zero? exit) (str/trim out))))

;; BL-925 invariant 2: the ONE definition of "is <sha> a QA-approved tip" -
;; shells out to is_qa_ancestor.sh, the same script
;; check_pipeline_code_on_main.sh (bash) calls, so a future rename of the
;; swarmforge-QA ref or a change to the ancestry predicate has exactly one
;; call site to update rather than two divergently-maintained git
;; invocations. Exit codes are that script's own (git merge-base
;; --is-ancestor's, passed straight through): 0 = is an ancestor, 1 = is NOT
;; (a clean, known "no" - never a failure), anything else = a real git
;; failure (e.g. an unresolvable sha) - :ok? false distinguishes that from a
;; clean :ancestor? false, so a real failure can fail closed instead of
;; silently reading as "not approved" for the wrong reason.
(defn- qa-ancestor? [sha]
  ;; BL-952: the shared script's exit 1 now covers two clean "no" shapes -
  ;; not-an-ancestor, and QA-BOUNCED (ancestry alone was the defect: a
  ;; bounced parcel stays reachable from swarmforge-QA because QA merged it
  ;; to review it). The script marks the bounce case with a "bounced:"
  ;; stderr line; surfaced here as :bounced? so qa-gate-decision can refuse
  ;; it regardless of the bookkeeping allowlist or trivial-merge exemption.
  ;; Exit >=2 stays the undeterminable fail-closed case (:ok? false),
  ;; which now also covers an unreadable/corrupt verdict store.
  (let [{:keys [exit err]} (daemon-cycle-guard-lib/sh! ["bash" (str (fs/path script-dir "is_qa_ancestor.sh")) sha]
                                        {:dir (str project-root)})]
    (cond
      (zero? exit) {:ok? true :ancestor? true :bounced? false}
      (= 1 exit) {:ok? true :ancestor? false
                  :bounced? (str/includes? (str err) "bounced:")}
      :else {:ok? false :ancestor? false :bounced? false})))

(defn- git-ahead-shas []
  (let [{:keys [exit out]} (daemon-cycle-guard-lib/sh! ["git" "rev-list" "origin/main..main"] {:dir (str project-root)})]
    (when (zero? exit)
      (->> (str/split-lines (str/trim out)) (remove str/blank?)))))

(defn- git-changed-paths [sha]
  (let [{:keys [exit out]} (daemon-cycle-guard-lib/sh! ["git" "diff-tree" "--no-commit-id" "--name-only" "-r" sha] {:dir (str project-root)})]
    (when (zero? exit)
      (->> (str/split-lines (str/trim out)) (remove str/blank?)))))

;; BL-630 bounce #2 (architect, 2026-07-30): `-c` (combined diff) reports a
;; path ONLY when a file's merge result differs from a trivial recombination
;; of its parents - i.e. it is empty for a clean/conflict-free merge and
;; non-empty exactly when the merge carries real content of its own (most
;; often a hand-resolved conflict, which exists in neither parent's tree
;; and so is invisible to every other commit's own single-parent diff). See
;; backlog/evidence/BL-630-push-sweep-refuses-non-qa-approved-main-bounce-
;; 20260730-2.md for the empirical proof this relies on.
(defn- git-changed-paths-combined [sha]
  (let [{:keys [exit out]} (daemon-cycle-guard-lib/sh! ["git" "diff-tree" "--no-commit-id" "--name-only" "-r" "-c" sha] {:dir (str project-root)})]
    (when (zero? exit)
      (->> (str/split-lines (str/trim out)) (remove str/blank?)))))

;; BL-630 bounce (architect, 2026-07-30): a merge commit has a real 2nd
;; parent iff `<sha>^2` resolves - reuses git-ref-exists? rather than adding
;; a second git-shelling helper.
(defn- git-merge-commit? [sha]
  (git-ref-exists? (str sha "^2")))

;; A merge commit's OWN combined diff (see git-changed-paths-combined above)
;; decides how it is scrutinized. Empty -> trivial merge, no independent
;; content: every real content-bearing commit it folds in already appears
;; as its OWN entry in this same ahead-shas range (git rev-list lists every
;; commit reachable in the range, not just the tip) with its own accurate,
;; single-parent changed-paths already checked there - push_sweep_lib.bb/
;; qa-gate-decision exempts exactly this case (:merge? true with empty
;; :changed-paths). Non-empty -> the merge carries content that belongs to
;; no other entry (bounce #1 first tried "plain diff-tree", which is always
;; empty for a merge regardless of content and was misread as "unknown ->
;; not bookkeeping"; bounce #2 then found that unconditionally exempting
;; every :merge? true sha waved through exactly this non-empty case, e.g. a
;; hand-resolved conflict, with zero review) - so a content-bearing merge's
;; combined-diff paths are carried through and checked by qa-gate-decision
;; exactly like a non-merge commit's :changed-paths.
(defn- ahead-commit-facts [sha]
  ;; BL-952: BOTH branches consult the shared verdict predicate now. The
  ;; merge branch previously never called it at all (its ancestry answer
  ;; was unused), which would have left a bounced MERGE commit invisible to
  ;; the veto - QA reviews merges, so a bounced sha can be one.
  (let [verdict (qa-ancestor? sha)]
    (if-not (:ok? verdict)
      {:sha sha :ok? false}
      (if (git-merge-commit? sha)
        (let [paths (git-changed-paths-combined sha)]
          {:sha sha :ok? (some? paths) :merge? true :qa-ancestor? false
           :bounced? (:bounced? verdict) :changed-paths (or paths [])})
        (let [paths (git-changed-paths sha)]
          {:sha sha :ok? (some? paths) :qa-ancestor? (:ancestor? verdict)
           :bounced? (:bounced? verdict) :changed-paths (or paths [])})))))

;; Shared git-sh helpers for push-sweep gatherers (BL-855 / BL-1098): one
;; project-root dir, exit-0-or-nil, never consult the working tree.
(defn- git-sh [{:keys [exit out]}]
  (when (zero? exit) out))

(defn- git-sh-trim [args]
  (some-> (git-sh (daemon-cycle-guard-lib/sh! args {:dir (str project-root)}))
          str/trim
          not-empty))

(defn- git-sh-lines [args]
  ;; Empty successful stdout must be [], not nil - callers treat nil as
  ;; gather failure (git-diff-name-only / merge-touched-path-set).
  (when-let [out (git-sh (daemon-cycle-guard-lib/sh! args {:dir (str project-root)}))]
    (->> (str/split-lines (str/trim out)) (remove str/blank?))))

(defn- git-diff-name-only [rev-a rev-b]
  (git-sh-lines ["git" "diff" "--name-only" rev-a rev-b]))

;; Both revs are explicit git refs (never omitted), so this is a tree-to-
;; tree diff purely against git objects - the shared, chronically-dirty,
;; hot-synced master checkout's working tree is never consulted (BL-855
;; invariant 3).
(defn- noop-merge-commit-facts [sha]
  (if (git-merge-commit? sha)
    (let [parent1 (str sha "^1")
          parent2 (str sha "^2")
          offered (git-diff-name-only parent1 parent2)
          tree-diff (git-diff-name-only parent1 sha)
          second-parent (git-rev-parse parent2)]
      {:sha sha :ok? (and (some? offered) (some? tree-diff) (some? second-parent))
       :merge? true
       :second-parent-sha second-parent
       :offered-paths (or offered [])
       ;; = [], not (empty? tree-diff): a git failure (tree-diff nil) must
       ;; read as "not known equal", never as an empty-seq false positive -
       ;; :ok? above already fails the whole gather closed in that case,
       ;; this is belt-and-suspenders against a future consumer that reads
       ;; this field without checking :ok? first.
       :tree-equals-parent1? (= tree-diff [])})
    {:sha sha :ok? true :merge? false}))

;; ── BL-1085: one ahead-range walk per tick + refusal cache ───────────────
;; Cache keyed on tip SHA + ordered ahead-SHA set. Replays a COMPLETE gather
;; only; never infers from tip alone (BL-952). Both gate adapters project
;; from ahead-range-facts! so a shared gatherer that is not wired into the
;; adapters map cannot silently leave both original walks running.
(def ^:private ahead-range-cache (atom nil))
(def ^:private ahead-range-tick-memo (atom nil))

(defn- qa-facts-from-ahead-shas [shas]
  ;; BL-952: the tip-is-ancestor fast path is GONE - every range is
  ;; enumerated per commit through the ONE shared verdict predicate.
  (if-not (git-ref-exists? "swarmforge-QA")
    {:qa-ref-exists? false :facts-complete? true}
    (let [commit-facts (mapv ahead-commit-facts shas)]
      (if (some (complement :ok?) commit-facts)
        {:qa-ref-exists? true :tip-is-qa-ancestor? false :facts-complete? false}
        {:qa-ref-exists? true :tip-is-qa-ancestor? false :facts-complete? true
         :ahead-commits (mapv #(select-keys % [:sha :qa-ancestor? :bounced? :changed-paths :merge?])
                              commit-facts)}))))

(defn- noop-facts-from-ahead-shas [shas]
  (let [commit-facts (mapv noop-merge-commit-facts shas)]
    (if (some (complement :ok?) commit-facts)
      {:facts-complete? false}
      {:facts-complete? true
       :ahead-commits (mapv #(select-keys % [:sha :merge? :second-parent-sha :offered-paths :tree-equals-parent1?])
                            commit-facts)})))

(defn- tip-ancestry-unreadable?
  "True when swarmforge-QA is present but tip ancestry cannot be read —
   fail closed rather than caching around a tooling hole."
  [qa-present? tip-check]
  (and qa-present? (or (nil? tip-check) (not (:ok? tip-check)))))

(defn- read-ahead-range-key! []
  (let [main-tip (git-rev-parse "main")
        shas (when main-tip (git-ahead-shas))
        qa-present? (boolean (git-ref-exists? "swarmforge-QA"))
        tip-check (when (and main-tip qa-present?) (qa-ancestor? main-tip))]
    (cond
      (nil? main-tip) nil
      (nil? shas) nil
      (tip-ancestry-unreadable? qa-present? tip-check) nil
      :else (push-sweep-ahead-range-lib/cache-key main-tip shas))))
(defn- enumerate-ahead-range! [{:keys [main-tip ahead-shas]}]
  (try
    (let [qa (qa-facts-from-ahead-shas ahead-shas)
          noop (noop-facts-from-ahead-shas ahead-shas)]
      {:complete? (and (true? (:facts-complete? qa)) (true? (:facts-complete? noop)))
       :qa-facts qa
       :noop-facts noop
       :ahead-shas (vec ahead-shas)
       :main-tip main-tip})
    (catch Exception e
      (log! "push-sweep-ahead-range-error" (.getMessage e))
      {:complete? false
       :qa-facts {:facts-complete? false}
       :noop-facts {:facts-complete? false}
       :ahead-shas (vec ahead-shas)
       :main-tip main-tip})))

(defn ahead-range-facts!
  "BL-1085 required_wiring anchor: single shared ahead-range gather (+ cache).
   Wired into the adapters map push_sweep_lib/sweep! is called with."
  []
  (push-sweep-ahead-range-lib/resolve-ahead-range-facts!
   {:cache-atom ahead-range-cache
    :tick-memo-atom ahead-range-tick-memo
    :read-key! read-ahead-range-key!
    :enumerate! enumerate-ahead-range!}))

(defn push-sweep-qa-gate-facts! []
  (try
    (:qa-facts (ahead-range-facts!))
    (catch Exception e
      (log! "push-sweep-qa-gate-error" (.getMessage e))
      {:facts-complete? false})))

(defn push-sweep-noop-merge-gate-facts! []
  (try
    (:noop-facts (ahead-range-facts!))
    (catch Exception e
      (log! "push-sweep-noop-merge-gate-error" (.getMessage e))
      {:facts-complete? false})))

;; BL-1098: real git wiring for push_sweep_lib.bb/silent-revert-decision.
;; Pure decision stays in the lib; this gatherer shells to git objects only
;; (never the working tree - every rev is an explicit ref:path). Candidate
;; paths are ONLY those merges in the ahead range touched (offered ∪ taken),
;; so cost is one authoring-commit lookup per candidate path, never a full
;; tree walk (invariant 3 / BL-1086).
(defn- git-blob-at [rev path]
  (git-sh-trim ["git" "rev-parse" (str rev ":" path)]))

(defn- git-newest-authoring-sha [ref path]
  (git-sh-trim ["git" "log" "-1" "--format=%H" "--no-merges" "--full-history" ref "--" path]))

(defn- git-authoring-shas [ref path]
  (git-sh-lines ["git" "log" "--format=%H" "--no-merges" "--full-history" ref "--" path]))

(defn- git-merges-after [older-sha ref path]
  (git-sh-lines ["git" "log" "--merges" "--full-history" "--reverse" "--format=%H"
                 (str older-sha ".." ref) "--" path]))

(defn- tip-holds-earlier-authored-blob? [ref path tip-blob newest-sha]
  (boolean (some (fn [sha]
                   (and (not= sha newest-sha)
                        (= tip-blob (git-blob-at sha path))))
                 (or (git-authoring-shas ref path) []))))

(defn- first-divergence-merge [ref path newest-sha newest-blob]
  (some (fn [merge-sha]
          (when (not= newest-blob (git-blob-at merge-sha path))
            merge-sha))
        (or (git-merges-after newest-sha ref path) [])))

(defn- silent-revert-no-author-facts [path]
  {:ok? true :path path :tip-matches-newest-authoring? true
   :tip-is-superseded-resurrection? false :tip-absent-without-delete? false
   :newest-authoring-sha nil :divergence-merge-sha nil})

(defn- silent-revert-authored-path-facts [ref path newest-sha]
  (let [tip-blob (git-blob-at ref path)
        newest-blob (git-blob-at newest-sha path)
        matches? (and (some? tip-blob) (= tip-blob newest-blob))
        absent-no-delete? (and (nil? tip-blob) (some? newest-blob))
        resurrection? (and (some? tip-blob) (not matches?)
                           (tip-holds-earlier-authored-blob? ref path tip-blob newest-sha))
        divergence (when (or resurrection? absent-no-delete?)
                     (first-divergence-merge ref path newest-sha newest-blob))]
    {:ok? true :path path
     :tip-matches-newest-authoring? (boolean matches?)
     :tip-is-superseded-resurrection? (boolean resurrection?)
     :tip-absent-without-delete? (boolean absent-no-delete?)
     :newest-authoring-sha newest-sha
     :divergence-merge-sha divergence}))

(defn- silent-revert-path-facts [ref path]
  (if-let [newest-sha (git-newest-authoring-sha ref path)]
    (silent-revert-authored-path-facts ref path newest-sha)
    (silent-revert-no-author-facts path)))

(defn- merge-touched-path-set [sha]
  (let [offered (git-diff-name-only (str sha "^1") (str sha "^2"))
        taken (git-diff-name-only (str sha "^1") sha)]
    (if (and (some? offered) (some? taken))
      {:ok? true :paths (set (concat offered taken))}
      {:ok? false})))

(def ^:private silent-revert-candidate-keys
  [:path :tip-matches-newest-authoring? :tip-is-superseded-resurrection?
   :tip-absent-without-delete? :newest-authoring-sha :divergence-merge-sha])

(defn- silent-revert-facts-from-paths [paths]
  (let [facts (mapv #(silent-revert-path-facts "main" %) paths)]
    (if (some (complement :ok?) facts)
      {:facts-complete? false}
      {:facts-complete? true
       :candidate-paths (mapv #(select-keys % silent-revert-candidate-keys) facts)})))

(defn- silent-revert-facts-from-merges [merge-shas]
  (let [path-sets (mapv merge-touched-path-set merge-shas)]
    (if (some (complement :ok?) path-sets)
      {:facts-complete? false}
      (-> path-sets
          push-sweep-lib/silent-revert-candidate-paths
          silent-revert-facts-from-paths))))

(defn push-sweep-silent-revert-gate-facts! []
  (try
    ;; BL-1085: reuse the shared ahead-sha list from ahead-range-facts! so
    ;; the ahead range is not walked a third time this tick.
    (let [shas (:ahead-shas (ahead-range-facts!))]
      (if (nil? shas)
        {:facts-complete? false}
        (silent-revert-facts-from-merges (filterv git-merge-commit? shas))))
    (catch Exception e
      (log! "push-sweep-silent-revert-gate-error" (.getMessage e))
      {:facts-complete? false})))

(defn push-sweep! []
  (try
    ;; BL-1085: clear per-tick memo so each push-sweep! starts clean; the
    ;; cross-tick refusal cache is left intact.
    (push-sweep-ahead-range-lib/begin-tick! ahead-range-tick-memo)
    (push-sweep-lib/sweep!
     (System/currentTimeMillis) (str daemon-dir) push-sweep-retry-config
     {:rev-counts! push-sweep-rev-counts!
      :push! push-sweep-push!
      :ahead-range-facts! ahead-range-facts!
      :qa-gate-facts! push-sweep-qa-gate-facts!
      :noop-merge-gate-facts! push-sweep-noop-merge-gate-facts!
      :silent-revert-gate-facts! push-sweep-silent-revert-gate-facts!
      :send-push-alarm!
      (fn [attempts reason]
        (send-push-alarm-email!
         "SwarmForge: main is not reaching origin"
         (str "Local `main` has failed to push to origin " attempts " times in a row. "
              "The swarm's committed work is not reaching origin - check network/auth "
              "and push by hand if needed."
              (when reason (str " Last error: " reason))
              "\n")))
      :send-divergence-alarm!
      (fn [ahead behind]
        (send-push-alarm-email!
         "SwarmForge: main has diverged from origin"
         (str "Local `main` is " ahead " commit(s) ahead and " behind " commit(s) behind "
              "origin/main - a plain push would be rejected (non-fast-forward) and was "
              "NOT attempted. A human needs to reconcile this by hand (fetch, then merge "
              "or rebase, then push).\n")))
      :log! (fn [& parts] (apply log! parts))})
    (catch Exception e
      (log! "push-sweep-error" (.getMessage e)))))

;; BL-891: mirror-image sweep of BL-356's push-sweep! above - origin's
;; LANDED commits never reach the master checkout's own `main` ref (QA can
;; only ever `git push origin HEAD:main`, which advances origin/main and
;; leaves local `main` exactly where it was; git refuses to update a branch
;; checked out in another worktree, so QA/coordinator have no way to do it
;; themselves - see this ticket's own notes for the incident). This is the
;; thin git/CLI-specific wiring; master_main_reconcile_lib.bb owns the pure
;; decision/state logic (BL-919: gating on dirty/merge-changed path overlap
;; rather than a blanket clean-tree check, self-healing surfaced-once
;; state). Reuses push-sweep-rev-counts! verbatim - "origin/main...main"
;; already yields exactly the {:ahead :behind} this sweep needs too, and it
;; already fetches as a side effect, so no second fetch is needed per tick.
(defn- master-main-reconcile-dirty-paths! []
  (let [{:keys [exit out]} (daemon-cycle-guard-lib/sh! ["git" "status" "--porcelain"] {:dir (str project-root)})]
    (if (zero? exit)
      (master-main-reconcile-lib/porcelain-lines->paths out)
      #{master-main-reconcile-lib/unknown-dirty-marker})))

;; BL-919: which paths would the incoming merge itself write to? Diffed
;; against the merge-base (not HEAD..origin/main, which would also include
;; paths only local commits touched) so this names exactly the paths a real
;; `git merge` would need to write - the same set reconcile-decision checks
;; dirty paths against for overlap. Only called when behind>0 (sweep!'s own
;; contract), so `origin/main` and a real merge-base always exist.
(defn- master-main-reconcile-merge-changed-paths! []
  (let [{:keys [exit out]} (daemon-cycle-guard-lib/sh! ["git" "merge-base" "HEAD" "origin/main"] {:dir (str project-root)})]
    (if (not (zero? exit))
      #{master-main-reconcile-lib/unknown-dirty-marker}
      (let [base (str/trim out)
            {:keys [exit out]} (daemon-cycle-guard-lib/sh! ["git" "diff" "--name-only" base "origin/main"] {:dir (str project-root)})]
        (if (zero? exit)
          (into #{} (remove str/blank?) (str/split-lines out))
          #{master-main-reconcile-lib/unknown-dirty-marker})))))

;; Never --force, --reset, --rebase, or --stash (BL-891 invariant 1): a
;; plain `git merge` either fast-forwards (no local-only commits) or
;; creates a real merge commit (local-only bookkeeping commits preserved
;; as first-parent history) - both leave every prior commit reachable. A
;; conflicted merge is aborted immediately so the checkout is left exactly
;; as it was found (invariant 2's "never partially updated") rather than
;; sitting mid-conflict for a human to stumble into.
;; BL-1120: if MERGE_HEAD already exists, a human (or other agent) owns the
;; merge — skip and surface, never git merge --abort.
(defn- master-main-merge-head-present? []
  (zero? (:exit (daemon-cycle-guard-lib/sh! ["git" "rev-parse" "-q" "--verify" "MERGE_HEAD"]
                                            {:dir (str project-root)}))))

(defn- master-main-origin-is-ancestor? []
  (zero? (:exit (daemon-cycle-guard-lib/sh! ["git" "merge-base" "--is-ancestor" "origin/main" "HEAD"]
                                            {:dir (str project-root)}))))

(defn- master-main-merge-would-conflict? []
  (let [{:keys [exit out]} (daemon-cycle-guard-lib/sh! ["git" "merge-base" "HEAD" "origin/main"]
                                                       {:dir (str project-root)})]
    (if (not (zero? exit))
      true
      (let [base (str/trim out)
            tree (daemon-cycle-guard-lib/sh! ["git" "merge-tree" base "HEAD" "origin/main"]
                                             {:dir (str project-root)})]
        (master-main-reconcile-lib/merge-tree-reports-conflict? (:out tree))))))

(defn- master-main-rematch-onto-origin!
  "BL-1138/1141: reset --hard origin/main. Never touches foreign MERGE_HEAD."
  [success-outcome failure-outcome]
  (if (master-main-merge-head-present?)
    {:success false :error "human-merge-in-progress" :outcome :human-merge-in-progress}
    (let [{:keys [exit err]} (daemon-cycle-guard-lib/sh!
                              ["git" "reset" "--hard" "origin/main"]
                              {:dir (str project-root)})]
      (if (zero? exit)
        {:success true :outcome success-outcome}
        {:success false
         :error (str/trim (or err (name failure-outcome)))
         :outcome failure-outcome}))))

(defn- master-main-reconcile-merge! []
  (let [{:keys [ahead behind]} (push-sweep-rev-counts!)
        tip-ok? (master-main-origin-is-ancestor?)
        conflict? (master-main-merge-would-conflict?)
        mid? (master-main-merge-head-present?)
        plan (master-main-reconcile-lib/absorb-dispatch-plan
              {:merge-head-present? mid?
               :behind behind
               :ahead ahead
               :tip-contains-origin? tip-ok?
               :would-conflict? conflict?
               :absorb-would-conflict? conflict?})]
    (case plan
      :skip-human-merge-in-progress
      {:success false :error "human-merge-in-progress" :outcome :human-merge-in-progress}

      :noop
      {:success true :outcome :noop}

      :replay-bookkeeping
      (master-main-rematch-onto-origin! :rematched-bookkeeping :rematch-bookkeeping)

      :refuse-rematch
      (master-main-rematch-onto-origin! :rematched-refuse :refuse-rematch)

      ;; :ff-absorb — rematch-prepared lands only; if FF fails, rematch (BL-1141).
      (let [{:keys [exit err]} (daemon-cycle-guard-lib/sh!
                                ["git" "merge" "--ff-only" "--no-edit" "origin/main"]
                                {:dir (str project-root)})]
        (cond
          (zero? exit) {:success true}
          mid?
          (do
            (when (master-main-reconcile-lib/may-abort-failed-merge? true)
              (daemon-cycle-guard-lib/sh! ["git" "merge" "--abort"] {:dir (str project-root)}))
            {:success false :error (str/trim (or err "")) :outcome :refuse-rematch})
          :else (master-main-rematch-onto-origin! :rematched-refuse :refuse-rematch))))))
;; Same outbound path as auto-route!/nudge-coordinator-unassigned! above:
;; a `note` shelled through swarm_handoff.bb (SWARMFORGE_ROLE=coordinator)
;; rather than a hand-written inbox file, reusing its full existing
;; validation, sequencing, and atomic outbox write.
(defn- master-main-reconcile-surface! [msg]
  (let [draft (write-scratch-draft! (master-main-reconcile-lib/surface-draft-lines msg))
        env (merge (into {} (System/getenv)) {"SWARMFORGE_ROLE" "coordinator"})
        result (daemon-cycle-guard-lib/sh! ["bb" (swarm-handoff-script) (str draft)] {:dir (str project-root) :env env})]
    (if (zero? (:exit result))
      (log! "master-main-reconcile-surfaced" msg)
      (log! "master-main-reconcile-surface-error" (str (:err result))))))

;; BL-920: the effective config's master_main_reconcile_escalation_threshold
;; - resolved via backlog-depth-lib/conf-file-path (whatever pack swarm-
;; identity recorded at launch), same resolution as open-slot-escalation-
;; threshold above.
(defn- master-main-reconcile-escalation-threshold []
  (master-main-reconcile-lib/parse-escalation-threshold
   (try (slurp (str (backlog-depth-lib/conf-file-path project-root)))
        (catch Exception _ nil))))

;; BL-920: a persistent block escalates to the operator - reuses the SAME
;; operator alert channel send-open-slot-escalation-alert! above already
;; established (Telegram OPERATOR topic outbox + email via daemon-alarm-
;; lib, sharing its ONE escalation-email-missing-key-warned? atom), notify
;; only, never halts the swarm - reconciling local `main` blocked is not the
;; daemon-death/endless-loop class of failure halt-for-endless-loop!/
;; halt-for-claim-progress! exist for.
(defn- master-main-reconcile-escalate! [{:keys [reason behind ticks]}]
  (let [reply-outbox (fs/path state-dir "operator" "telegram-reply-outbox.jsonl")
        subject (master-main-reconcile-lib/escalation-email-subject reason)
        tg-text (master-main-reconcile-lib/escalation-telegram-text reason behind ticks)
        body (master-main-reconcile-lib/escalation-reason reason behind ticks)]
    (log! "master-main-reconcile-escalation" (name reason) body)
    (try
      (fs/create-dirs (fs/parent reply-outbox))
      (spit (str reply-outbox)
            (str (json/generate-string {"threadId" "OPERATOR" "text" tg-text}) "\n")
            :append true)
      (log! "master-main-reconcile-escalation-telegram" (name reason))
      (catch Exception e (log! "master-main-reconcile-escalation-telegram-error" (.getMessage e))))
    (try
      (daemon-alarm-lib/send-configured-email!
       project-root conf-file subject body
       {:already-warned?! (fn [] @escalation-email-missing-key-warned?)
        :log-warning! (fn [msg] (log! "email-misconfigured" msg))
        :mark-warned! (fn [] (reset! escalation-email-missing-key-warned? true))})
      (log! "master-main-reconcile-escalation-email" (name reason))
      (catch Exception e (log! "master-main-reconcile-escalation-email-error" (.getMessage e))))))

(defn master-main-reconcile-sweep! []
  (try
    (master-main-reconcile-lib/sweep!
     (str daemon-dir)
     (master-main-reconcile-escalation-threshold)
     {:rev-counts! push-sweep-rev-counts!
      :dirty-paths! master-main-reconcile-dirty-paths!
      :merge-changed-paths! master-main-reconcile-merge-changed-paths!
      :merge! master-main-reconcile-merge!
      :surface! master-main-reconcile-surface!
      :escalate! master-main-reconcile-escalate!
      :log! (fn [& parts] (apply log! parts))})
    (catch Exception e
      (log! "master-main-reconcile-sweep-error" (.getMessage e)))))

(defn- git-rev-parse-in [dir ref]
  (let [{:keys [exit out]} (daemon-cycle-guard-lib/sh! ["git" "rev-parse" ref] {:dir dir})]
    (when (zero? exit) (str/trim out))))

(defn- git-is-ancestor? [dir ancestor descendant]
  (zero? (:exit (daemon-cycle-guard-lib/sh!
                  ["git" "merge-base" "--is-ancestor" ancestor descendant]
                  {:dir dir}))))

(defn- post-qa-branch-sweep-role-dirty? [worktree-path]
  (let [{:keys [exit out]} (daemon-cycle-guard-lib/sh! ["git" "status" "--porcelain"]
                                        {:dir worktree-path})]
    (and (zero? exit) (not (str/blank? (str/trim out))))))

(defn- post-qa-branch-sweep-role-in-process? [role-info]
  (let [dir (handoff-lib/mailbox-dir role-info :in_process)]
    (and (fs/directory? dir)
         (boolean
          (some #(str/ends-with? (str (fs/file-name %)) ".handoff")
                (fs/list-dir dir))))))

(defn- post-qa-branch-sweep-role-facts! [role-name]
  (when-let [ri (handoff-lib/load-role-info role-name (str project-root))]
    (let [wt (:worktree-path ri)
          head (git-rev-parse-in wt "HEAD")
          landed (git-rev-parse "origin/main")]
      {:head-sha head
       :dirty? (post-qa-branch-sweep-role-dirty? wt)
       :in-process? (post-qa-branch-sweep-role-in-process? ri)
       :can-ff? (and head landed (git-is-ancestor? wt head landed))
       :worktree-path wt})))

(defn- post-qa-branch-sweep-ff! [_role-name facts]
  (let [wt (:worktree-path facts)
        {:keys [exit err]} (daemon-cycle-guard-lib/sh!
                            ["git" "merge" "--ff-only" "--no-edit" "origin/main"]
                            {:dir wt})]
    (if (zero? exit)
      {:success true}
      {:success false :error (str/trim (or err ""))})))

(defn post-qa-branch-sweep-sweep! []
  (try
    (git-fetch-origin-main!)
    (let [landed (git-rev-parse "origin/main")
          roles (->> (handoff-lib/load-all-roles (str project-root))
                     (filter post-qa-branch-sweep-lib/sweep-eligible-role?)
                     (map :role))]
      (when landed
        (post-qa-branch-sweep-lib/sweep!
         (str daemon-dir) landed roles
         {:role-facts! post-qa-branch-sweep-role-facts!
          :fast-forward! post-qa-branch-sweep-ff!
          :log! (fn [& parts] (apply log! parts))})))
    (catch Exception e
      (log! "post-qa-branch-sweep-error" (.getMessage e)))))

(defn- coordinator-in-process-aged?
  "True when coordinator inbox/in_process holds a *.handoff older than 15 min."
  []
  (try
    (let [ri (handoff-lib/load-role-info "coordinator" (str project-root))
          dir (when ri (handoff-lib/mailbox-dir ri :in_process))
          cutoff (- (System/currentTimeMillis) (* 15 60 1000))]
      (boolean
       (when (and dir (fs/directory? dir))
         (->> (fs/list-dir dir)
              (filter #(str/ends-with? (str (fs/file-name %)) ".handoff"))
              (some (fn [p]
                      (let [lm (.toMillis (fs/last-modified-time p))]
                        (<= lm cutoff))))))))
    (catch Exception _ false)))

(defn main-sync-deadlock-sweep! []
  "Trip-once when diverged/dirty main holds aged coordinator bookkeeping."
  (try
    (let [counts (push-sweep-rev-counts!)
          ahead (or (:ahead counts) 0)
          behind (or (:behind counts) 0)
          reconcile (master-main-reconcile-lib/read-state (str daemon-dir))
          deadlock (master-main-reconcile-lib/read-deadlock (str daemon-dir))]
      (when (master-main-reconcile-lib/deadlock-clear? behind)
        (when (master-main-reconcile-lib/deadlock-active? deadlock)
          (master-main-reconcile-lib/clear-deadlock! (str daemon-dir))
          (log! "main-sync-deadlock-cleared" "behind=0")))
      (let [deadlock (master-main-reconcile-lib/read-deadlock (str daemon-dir))
            blocked-ticks (or (:ticks reconcile) 0)
            due? (master-main-reconcile-lib/deadlock-trip-due?
                  {:ahead ahead :behind behind
                   :reconcile-surfaced (:surfaced reconcile)
                   :reconcile-escalated (:escalated reconcile)
                   :coordinator-in-process-aged? (coordinator-in-process-aged?)
                   :blocked-ticks (max blocked-ticks 3)
                   :deadlock-state deadlock
                   :threshold-ticks 3})]
        (when due?
          (let [payload {:active true
                         :reason (or (:surfaced reconcile) "diverged")
                         :ahead ahead :behind behind
                         :tripped_at (str (java.time.Instant/now))
                         :alerted true}]
            (master-main-reconcile-lib/write-deadlock! (str daemon-dir) payload)
            (log! "main-sync-deadlock-tripped" ahead behind)
            (let [subject (master-main-reconcile-lib/deadlock-alert-subject)
                  body (master-main-reconcile-lib/deadlock-alert-text
                        {:ahead ahead :behind behind :reason (:reason payload)})
                  reply-outbox (fs/path state-dir "operator" "telegram-reply-outbox.jsonl")]
              (try
                (fs/create-dirs (fs/parent reply-outbox))
                (spit (str reply-outbox)
                      (str (json/generate-string {"threadId" "OPERATOR" "text" body}) "\n")
                      :append true)
                (catch Exception e (log! "main-sync-deadlock-telegram-error" (.getMessage e))))
              (try
                (daemon-alarm-lib/send-configured-email!
                 project-root conf-file subject body
                 {:already-warned?! (fn [] @escalation-email-missing-key-warned?)
                  :log-warning! (fn [msg] (log! "email-misconfigured" msg))
                  :mark-warned! (fn [] (reset! escalation-email-missing-key-warned? true))})
                (catch Exception e (log! "main-sync-deadlock-email-error" (.getMessage e)))))))))
    (catch Exception e
      (log! "main-sync-deadlock-sweep-error" (.getMessage e)))))

;; BL-437: shells to the compiled emit-fleet-status.js CLI (Babashka has no
;; way to import compiled TS) - reuses createSwarmNode/rollupStatus
;; unchanged, the exact same rollup fleet-console.ts used to reconstruct for
;; a single swarm before this ticket, so a published doc can never disagree
;; with what a live in-process reconstruction would say. Publishes THIS
;; swarm's own rolled-up status.json into the fleet rendezvous dir under
;; the operator host's $HOME, flipping BL-246's backwards coupling back to
;; BL-242's own principle: the swarm rolls up its own pack, the fleet
;; console just merges. Shares the chase-sweep cadence (no separate
;; timeout), same rationale as every other *-sweep! sharing it above. Any
;; failure (CLI not yet compiled, etc.) degrades to a logged skip - never
;; crashes the sweep; a status.json that simply stops updating is exactly
;; what fleet-console.ts is designed to notice and report as "stopped
;; (coordinator lost)".
(defn fleet-status-sweep! []
  (try
    (let [cli-path (node-tool-path "emit-fleet-status.js")]
      ;; BL-1010: a checkout that has never been built fails here every cycle
      ;; with node's module-not-found, which names the BUILD ARTIFACT rather
      ;; than the bring-up step that is missing - loud, repeated and
      ;; unactionable, as the WSL2 secondary reported. Check first and say what
      ;; to run instead of letting node describe a path.
      (if-not (fs/exists? cli-path)
        (log! "fleet-status-sweep-error"
              (node-tool-bringup-lib/missing-tool-message "emit-fleet-status.js" (str cli-path)))
        (let [{:keys [exit err]} (daemon-cycle-guard-lib/sh! ["node" cli-path (str project-root)] {:dir (str project-root)})]
          (when-not (zero? exit)
            (log! "fleet-status-sweep-error" (str "exit=" exit " " (str/trim (or err ""))))))))
    (catch Exception e
      (log! "fleet-status-sweep-error" (.getMessage e)))))

;; BL-440: shells to the compiled drain-answer-files.js CLI (Babashka has no
;; way to import compiled TS) - reuses drainAnswerFiles unchanged, the exact
;; gate+route+archive orchestration drainAnswerFilesCli.test.js already
;; proves. This is the runtime-wiring slice the architect bounced back for:
;; a grep of the whole tree found nothing calling drainAnswerFiles but its
;; own CLI entry point and its own tests, so a human's committed
;; ANSWER-*.md never got drained unless someone ran the CLI by hand - the
;; same "pure module, zero production callers, dark feature" gap the
;; epic-runtime-wiring-slice rule in the engineering article exists to
;; close. Shares the chase-sweep cadence (no separate timeout), same
;; rationale as every other *-sweep! sharing it above. The CLI already
;; commits both of its own side effects (the BL-topic record append and the
;; archive move), so there is nothing left for this sweep to commit - it
;; only needs to fire the CLI and surface its result. Any failure (CLI not
;; yet compiled, etc.) degrades to a logged error - never crashes the sweep.
(defn answer-file-drain-sweep! []
  (try
    (let [cli-path (node-tool-path "drain-answer-files.js")
          {:keys [exit out err]} (daemon-cycle-guard-lib/sh! ["node" cli-path (str project-root)] {:dir (str project-root)})]
      (if (zero? exit)
        (log! "answer-file-drain" (str/trim out))
        (log! "answer-file-drain-sweep-error" (str "exit=" exit " " (str/trim (or err ""))))))
    (catch Exception e
      (log! "answer-file-drain-sweep-error" (.getMessage e)))))

;; BL-423: shells to the compiled resume-expired-pauses.js CLI, same
;; posture as dead-letter-notify-sweep! above - the
;; ticket's own "ride the daemon's existing sweep cadence" instruction for
;; the timed-pause auto-resume + its Control-topic announcement. The CLI
;; itself owns the pause-expiry decision (decidePauseAutoResume, an
;; injected-clock pure function) and the marker clear/announce; this
;; adapter only owns invoking it.
(defn pause-auto-resume-sweep! []
  (try
    (let [cli-path (node-tool-path "resume-expired-pauses.js")
          {:keys [exit out err]} (daemon-cycle-guard-lib/sh! ["node" cli-path] {:dir (str project-root)})]
      (if (zero? exit)
        (log! "pause-auto-resume" (str/trim out))
        (log! "pause-auto-resume-sweep-error" (str "exit=" exit " " (str/trim (or err ""))))))
    (catch Exception e
      (log! "pause-auto-resume-sweep-error" (.getMessage e)))))

;; BL-617: shells to the compiled apply-cooldown-pause.js CLI, same posture
;; as pause-auto-resume-sweep! above - a scheduler over the existing
;; timed-pause machinery, riding the daemon's existing sweep cadence per the
;; ticket's own instruction. The CLI owns the cooldown decision
;; (decideCooldownWindow, an injected-clock pure function), the once-per-
;; window marker, and the Control-topic announcement; this adapter only
;; owns invoking it. Must keep running even while a pause (human or
;; cooldown) is already active - it is one of the two sweeps that decide
;; whether to CHANGE pause state, never suppressed by outbound-wake
;; suppression below (which only ever gates delivery/nudge/chase wakes).
(defn cooldown-sweep! []
  (try
    (let [cli-path (node-tool-path "apply-cooldown-pause.js")
          {:keys [exit out err]} (daemon-cycle-guard-lib/sh! ["node" cli-path] {:dir (str project-root)})]
      (if (zero? exit)
        (log! "cooldown-sweep" (str/trim out))
        (log! "cooldown-sweep-error" (str "exit=" exit " " (str/trim (or err ""))))))
    (catch Exception e
      (log! "cooldown-sweep-error" (.getMessage e)))))

;; BL-258: headless, host-independent morning trigger for briefing
;; GENERATION (complements briefing-email-sweep! above, which only handles
;; the SEND of an already-committed file). Reads the configured morning
;; time the same way send-configured-briefing-email! reads notify_email_to
;; above - daemon_alarm_lib.bb's shared parse-conf, one convention for every
;; daemon-level swarmforge.conf key.
(defn configured-morning-time []
  (let [conf (daemon-alarm-lib/parse-conf (when (fs/exists? conf-file) (slurp (str conf-file))))]
    (briefing-generation-schedule-lib/parse-morning-time (get conf "briefing_morning_time_utc"))))

;; BL-897: ensures that shared snapshot (lifecycle-snapshot-path, defined
;; near project-root above) is fresh (today's) before any
;; section below reads it (extension/src/tools/emit-lifecycle-snapshot.ts,
;; compiled to out/tools/emit-lifecycle-snapshot.js) - idempotent within a
;; day, so calling this unconditionally on every daemon tick is safe; the
;; real walk happens on at most one tick per UTC day. Best-effort like the
;; sections below: any failure here just means every consumer falls back to
;; its own walk exactly as it did before this ticket, never a lost
;; briefing - never propagated as an exception.
(defn ensure-lifecycle-snapshot! []
  (try
    (let [cli-path (node-tool-path "emit-lifecycle-snapshot.js")
          {:keys [exit out]} (daemon-cycle-guard-lib/sh! ["node" cli-path] {:dir (str project-root)})]
      (if (zero? exit)
        (log! "lifecycle-snapshot-ensured" (str/trim out))
        (log! "lifecycle-snapshot-ensure-nonzero-exit" (str exit))))
    (catch Exception e
      (log! "ensure-lifecycle-snapshot-error" (.getMessage e)))))

;; BL-272: headless entrypoint for BL-213's deterministic cost & health
;; sidecar emitter (extension/src/tools/emit-cost-health-sidecar.ts,
;; compiled to out/tools/emit-cost-health-sidecar.js) - the same
;; compute -> write -> commit path extension.ts's onBriefingDue calls
;; in-process from a VS Code host. A non-zero exit is surfaced as a thrown
;; exception so generate-briefing-if-due!'s own try/catch around
;; :emit-sidecar! stays the single place that makes this best-effort;
;; this adapter does not need its own try/catch.
(defn emit-cost-health-sidecar! []
  (let [cli-path (node-tool-path "emit-cost-health-sidecar.js")
        {:keys [exit out err]} (daemon-cycle-guard-lib/sh! ["node" cli-path "--snapshot" lifecycle-snapshot-path] {:dir (str project-root)})]
    (if (zero? exit)
      (log! "cost-health-sidecar-emitted" (str/trim out))
      (throw (ex-info "emit-cost-health-sidecar.js failed" {:exit exit :err err})))))

;; ── BL-308: headless, no-agent briefing composer for banked (hibernated) mode ─
;; The pure content composer is banked_briefing_lib.bb; everything below is
;; the impure gathering of the "cheap headless signals" that ticket asks
;; for, following the exact same shell-out-and-degrade-to-nil/empty pattern
;; as suite-duration-briefing-line/needs-approval-briefing-section above -
;; a gathering failure degrades quietly, it never crashes the sweep.

(defn read-hibernation-state []
  (when (fs/exists? hibernation-state-file)
    (try (json/parse-string (slurp (str hibernation-state-file)) true) (catch Exception _ nil))))

(defn swarm-hibernated? []
  (boolean (:hibernated (read-hibernation-state))))

(defn- count-yaml-files [dir]
  (if (fs/exists? dir)
    (count (filter #(str/ends-with? (fs/file-name %) ".yaml") (fs/list-dir dir)))
    0))

(defn banked-backlog-counts []
  {:active (count-yaml-files backlog-active-dir)
   :paused (count-yaml-files backlog-paused-dir)
   :done (count-yaml-files backlog-done-dir)})

;; git log since the prior UTC day-key, oneline - degrades to [] on any
;; failure (not yet a git repo in some fixture, git not on PATH, etc.).
(defn recent-git-activity-lines [day-key]
  (try
    (let [since (str (banked-briefing-lib/prior-day-key day-key) "T00:00:00Z")
          {:keys [exit out]} (daemon-cycle-guard-lib/sh! ["git" "log" "--oneline" (str "--since=" since)]
                                          {:dir (str project-root)})]
      (if (zero? exit)
        (vec (remove str/blank? (str/split-lines out)))
        []))
    (catch Exception _ [])))

;; Reuses BL-272's own committed docs/briefings/<day>.json sidecar (already
;; emitted by :emit-sidecar! just before this runs, same day-key) rather
;; than computing daemon health a second way - degrades to [] when the
;; sidecar is missing/unreadable/has no reliability data this run.
(defn banked-daemon-health-lines [day-key]
  (try
    (let [sidecar-path (fs/path briefings-dir (str day-key ".json"))]
      (if (fs/exists? sidecar-path)
        (let [{:keys [reliability]} (json/parse-string (slurp (str sidecar-path)) true)]
          (if reliability
            [(str "chases=" (get-in reliability [:chases :value] 0)
                  " nudges=" (get-in reliability [:nudges :value] 0)
                  " respawns=" (get-in reliability [:respawns :value] 0)
                  " failedDeliveries=" (get-in reliability [:failedDeliveries :value] 0))]
            []))
        []))
    (catch Exception _ [])))

(defn compose-and-write-banked-briefing! [day-key]
  (let [state (read-hibernation-state)
        content (banked-briefing-lib/compose-banked-briefing
                 {:day-key day-key
                  :profile-name (banked-briefing-lib/profile-name-from-config-path (:config_path state))
                  :hibernated-at-ms (:hibernated_at_ms state)
                  :backlog-counts (banked-backlog-counts)
                  :git-activity-lines (recent-git-activity-lines day-key)
                  :daemon-health-lines (banked-daemon-health-lines day-key)})]
    (spit (str (fs/path briefings-dir (str day-key ".md"))) content)))

;; BL-658: consult the night-closing-ceremony gate before the fixed morning
;; trigger. When closure_stop_local is usable, the independent 04:30 clock
;; must not fire — briefing is the ceremony's last act. Absent/ambiguous
;; schedules keep today's fixed-time path (byte-identical for 24/7 swarms).
(defn night-closing-ceremony-gate []
  (try
    ;; Resolve the CLI from the handoffd checkout (same tree as conf-file),
    ;; not project-root — wiring fixtures use a throwaway root without
    ;; extension/out, but conf is already script-dir-relative.
    (let [cli-path (str (fs/path script-dir ".." ".." "extension" "out" "tools"
                                 "night-closing-ceremony-gate.js"))
          conf-arg (when (fs/exists? conf-file) ["--conf" (str conf-file)])
          {:keys [exit out err]} (daemon-cycle-guard-lib/sh!
                                  (into ["node" cli-path] (or conf-arg []))
                                  ;; Checkout root (has .git) — not the fixture
                                  ;; project-root. resolveCliMainWorktreeContext
                                  ;; needs a git repo even when --conf is set.
                                  {:dir (str (fs/canonicalize (fs/path script-dir ".." "..")))})]
      (if (zero? exit)
        (try (json/parse-string (str/trim out) true)
             (catch Exception e
               (log! "closing-ceremony-gate-parse-error" (.getMessage e))
               nil))
        (do (log! "closing-ceremony-gate-error" (str "exit=" exit " " (str/trim (or err ""))))
            nil)))
    (catch Exception e
      (log! "closing-ceremony-gate-error" (.getMessage e))
      nil)))

(defn night-closing-ceremony-run! []
  (try
    (let [cli-path (str (fs/path script-dir ".." ".." "extension" "out" "tools"
                                 "night-closing-ceremony-run.js"))
          conf-arg (when (fs/exists? conf-file) ["--conf" (str conf-file)])
          target-arg ["--target" (str project-root)]
          {:keys [exit out err]} (daemon-cycle-guard-lib/sh!
                                  (into ["node" cli-path] (concat (or conf-arg []) target-arg))
                                  {:dir (str (fs/canonicalize (fs/path script-dir ".." "..")))})]
      (if (zero? exit)
        (log! "closing-ceremony-run" (str/trim out))
        (log! "closing-ceremony-run-error" (str "exit=" exit " " (str/trim (or err ""))))))
    (catch Exception e
      (log! "closing-ceremony-run-error" (.getMessage e)))))

(defn briefing-generation-sweep! [roles socket]
  (let [gate (night-closing-ceremony-gate)
        ceremony-mode? (= "ceremony" (str (:mode gate)))]
    ;; BL-658 architect bounce D1: when the gate says ceremony mode, drive
    ;; the live sequence (freeze/drain/rotate/brief/send/stop) — logging
    ;; closing-ceremony-due alone is not the ticket.
    (when ceremony-mode?
      (night-closing-ceremony-run!))
    (when (and gate (= "ambiguous" (str (:scheduleState gate))))
      (log! "closing-ceremony-schedule-ambiguous" (str (:surfaced gate))))
    ;; Fixed morning trigger only when the gate says so (or gate failed open
    ;; to today's behaviour — nil gate keeps legacy fire).
    (when (or (nil? gate) (true? (:consultFixedMorningTrigger gate)))
      (let [[hour minute] (configured-morning-time)]
        (briefing-generation-schedule-lib/generate-briefing-if-due!
         (System/currentTimeMillis) hour minute (str briefings-dir) (swarm-hibernated?)
         {:notify! (fn [instruction-text]
                     (if (tmux-inject-disabled?)
                       (log! "briefing-generation-skip-mailbox-only")
                       (when-let [coordinator (get roles "coordinator")]
                         (agent-runtime-inject/notify-agent!
                          socket (:session coordinator) (or (:agent coordinator) "claude")
                          :log-fn (fn [tag sess detail] (log! tag sess detail))
                          :text instruction-text))))
          :compose-headless! compose-and-write-banked-briefing!
          :emit-sidecar! emit-cost-health-sidecar!
          :log! (fn [& parts] (apply log! parts))})))))

;; ── BL-309: coordinator context-clear at the safe idle boundary after a
;;    ticket's bookkeeping close ────────────────────────────────────────────
;; The pure decision is closing_context_clear_lib.bb; everything below is
;; the impure gathering/adapter side, following the exact same
;; degrade-quietly-never-crash-the-sweep posture as every other sweep here.

;; The most recently closed ticket id: backlog/done/'s own newest-mtime
;; entry, per the ticket's own wording ("a ticket file present in
;; backlog/done/ that was not there at the last check") - cheap, no new
;; state needed to detect it. nil when backlog/done/ is empty/absent.
(defn latest-done-ticket-id []
  (when (fs/exists? backlog-done-dir)
    (let [entries (filter #(str/ends-with? (fs/file-name %) ".yaml") (fs/list-dir backlog-done-dir))]
      (when (seq entries)
        (-> (apply max-key #(.toMillis (fs/last-modified-time %)) entries)
            fs/file-name
            (str/replace #"\.yaml$" ""))))))

(defn read-last-cleared-ticket-id []
  (when (fs/exists? context-clear-marker-file)
    (try
      (:last_cleared_ticket_id (json/parse-string (slurp (str context-clear-marker-file)) true))
      (catch Exception _ nil))))

(defn record-context-clear! [ticket-id]
  (spit (str context-clear-marker-file)
        (json/generate-string {:last_cleared_ticket_id ticket-id
                                :cleared_at_ms (System/currentTimeMillis)})))

;; role-idle? mirrors operator_lib.bb's BL-307 shape exactly (reused, not
;; reimplemented); the counts themselves reuse chase_sweep_lib.bb's own
;; scan-inbox-new/scan-in-process (already loaded here for the chase sweep)
;; rather than a third copy of that directory-walking logic. Generic over
;; role-info (BL-316): the coordinator sweep below and the generalized
;; per-role sweep further down both call this same fn.
(defn role-mailbox-idle? [role-info]
  (operator-lib/role-idle?
   {:inbox-new-count (count (chase-sweep-lib/scan-inbox-new (handoff-lib/mailbox-dir role-info :new)))
    :in-process-count (count (chase-sweep-lib/scan-in-process (handoff-lib/mailbox-dir role-info :in_process)))}))

;; Defined AFTER role-mailbox-idle? so babashka/SCI analysis does not abort
;; load before pid claim (hotfix ca45facb4 / BL-1150).
(defn outage-driven-seat-failover-sweep!
  "BL-669: sustained outage -> steward consult -> certified substitute at idle."
  [roles socket]
  (outage-failover-cli/outage-driven-seat-failover!
   project-root roles socket
   :seat-idle-fn #(let [ri (role-info-by-name roles %)]
                     (if ri (role-mailbox-idle? ri) true))
   :attended? (= "1" (System/getenv "OUTAGE_FAILOVER_ATTENDED"))))

;; Shared by every context-clear sweep below (coordinator and per-role,
;; BL-316): both inject via the same agent-runtime-inject/notify-agent!
;; call, differing only in which role-info/socket they target - only
;; :record-clear! differs per sweep, so that stays sweep-local.
(defn context-clear-injectors [socket role-info]
  (let [session (handoff-lib/wake-session socket (:session role-info))]
    {:inject-clear! (fn []
                       (agent-runtime-inject/notify-agent!
                        socket session (or (:agent role-info) "claude")
                        :log-fn (fn [tag sess detail] (log! tag sess detail))
                        :text "/clear"))
     :inject-startup-reread! (fn [instruction-text]
                                (agent-runtime-inject/notify-agent!
                                 socket session (or (:agent role-info) "claude")
                                 :log-fn (fn [tag sess detail] (log! tag sess detail))
                                 :text instruction-text))}))

(defn closing-context-clear-sweep! [roles socket]
  ;; BL-309 bounce fix: :record-clear! durably poisons closed-ticket-id
  ;; against ever being re-cleared (new-close?'s whole point). Skip the
  ;; WHOLE sweep - never even evaluate the decision - while tmux injection
  ;; is disabled (SWARMFORGE_MAILBOX_ONLY / SWARMFORGE_SKIP_TMUX_INJECT),
  ;; so a mailbox-only session can never mark a close cleared when nothing
  ;; was actually injected into the coordinator's pane. Mirrors
  ;; briefing-generation-sweep!'s own :notify! skip, which never writes any
  ;; persistent "already notified" marker either.
  (if (tmux-inject-disabled?)
    (log! "closing-context-clear-skip-mailbox-only")
    (when-let [coordinator (get roles "coordinator")]
      (closing-context-clear-lib/evaluate-closing-context-clear!
       {:idle? (role-mailbox-idle? coordinator)
        :closed-ticket-id (latest-done-ticket-id)
        :last-cleared-ticket-id (read-last-cleared-ticket-id)
        :role-name "coordinator"}
       (merge (context-clear-injectors socket coordinator)
              {:record-clear! (fn [ticket-id]
                                 (record-context-clear! ticket-id)
                                 (log! "closing-context-clear-fired" ticket-id))})))))

;; ── BL-316: generalized per-role context-clear at the safe idle boundary
;;    after a role's OWN inbox/completed/ gains a fresh entry ─────────────
;; Same pure decision (closing_context_clear_lib.bb), same
;; degrade-quietly-never-crash-the-sweep posture as every sweep in this
;; file - only the "what just finished" signal differs from the
;; coordinator's own bookkeeping-close signal above: here it is a fresh
;; entry in the role's own inbox/completed/ (a single .handoff file for a
;; task role, or a whole batch_* directory landing at once for a batch
;; role). The coordinator is deliberately excluded - it keeps its own
;; dedicated mechanism/marker above, untouched.

(defn latest-completed-entry-id
  "The most recently modified top-level entry in role-info's own
   inbox/completed/ - a .handoff file for a task role, or a batch_*
   directory (as a single unit, not its individual members) for a batch
   role. nil when the directory is empty/absent."
  [role-info]
  (let [dir (handoff-lib/mailbox-dir role-info :completed)]
    (when (fs/exists? dir)
      (let [entries (->> (fs/list-dir dir)
                          (filter (fn [p]
                                    (or (and (fs/regular-file? p) (str/ends-with? (fs/file-name p) ".handoff"))
                                        (and (fs/directory? p) (str/starts-with? (fs/file-name p) "batch_")))))
                          vec)]
        (when (seq entries)
          (-> (apply max-key #(.toMillis (fs/last-modified-time %)) entries)
              fs/file-name))))))

(defn read-role-context-clear-marker []
  (if (fs/exists? role-context-clear-marker-file)
    (try (json/parse-string (slurp (str role-context-clear-marker-file)) true)
         (catch Exception _ {}))
    {}))

(defn read-role-last-cleared [role-name]
  (get (read-role-context-clear-marker) (keyword role-name)))

(defn record-role-context-clear! [role-name entry-id]
  (spit (str role-context-clear-marker-file)
        (json/generate-string (assoc (read-role-context-clear-marker) (keyword role-name) entry-id))))

(defn role-context-clear-sweep! [roles socket]
  (cond
    (tmux-inject-disabled?)
    (log! "role-context-clear-skip-mailbox-only")

    (rotation-router-mode?)
    (log! "role-context-clear-skip-rotation-router")

    :else
    (doseq [[role-name role-info] roles
            :when (not= role-name "coordinator")]
      (try
        (closing-context-clear-lib/evaluate-closing-context-clear!
         {:idle? (role-mailbox-idle? role-info)
          :closed-ticket-id (latest-completed-entry-id role-info)
          :last-cleared-ticket-id (read-role-last-cleared role-name)
          :role-name role-name}
         (merge (context-clear-injectors socket role-info)
                {:record-clear! (fn [entry-id]
                                   (record-role-context-clear! role-name entry-id)
                                   (log! "role-context-clear-fired" role-name entry-id))}))
        (catch Exception e
          (log! "role-context-clear-role-error" role-name (.getMessage e)))))))

(defn -main []
  (let [roles  (load-roles)
        socket (str/trim (slurp (str socket-file)))]
    (self-heal-stale-stubs! roles)
    (log-rotation-actionability-ordering-warnings!)
    (cond
      poll-once-only?
      (do
        (poll-once!)
        (canary-sweep!)
        (log! "poll-once done"))

      startup-notify-only?
      (do
        (startup-notify-pending! roles socket)
        (log! "startup-notify-only done"))

      print-preferred-rotate-target-only?
      (let [target (preferred-mono-rotate-role roles)]
        (println (or target "none"))
        (log! "print-preferred-rotate-target done" (or target "none")))

      sweep-once-only?
      (do
        ;; Each call isolated exactly like the real main-loop cadence block
        ;; below - one sweep's failure must never mask another's, in a test
        ;; harness no less than in the live daemon.
        (try (poll-once!) (catch Exception e (log! "poll-once-error" (.getMessage e))))
        (try (open-slot-nudge-sweep! roles) (catch Exception e (log! "open-slot-nudge-sweep-error" (.getMessage e))))
        (try (flow-watchdog-sweep! roles socket) (catch Exception e (log! "flow-watchdog-sweep-error" (.getMessage e))))
        (try (ambulance-auto-exit-sweep!) (catch Exception e (log! "ambulance-auto-exit-sweep-error" (.getMessage e))))
        (log! "sweep-once done"))

      chase-sweep-once-only?
      (do
        (try (chase-sweep! roles socket) (catch Exception e (log! "chase-sweep-once-error" (.getMessage e))))
        (log! "chase-sweep-once done"))

      :else
      (let [claim (claim-pid-file!)]
        (if-let [conflicting (and (vector? claim) (second claim))]
          (do
            (log! "abort-second-start" (str "live handoffd pid=" conflicting "already owns" (str pid-file)))
            (binding [*out* *err*]
              (println (str "handoffd.bb: refusing to start; live handoffd (pid " conflicting
                            ") already owns " (str pid-file))))
            (System/exit 1))
          (do
            (reset! main-thread (Thread/currentThread))
            (.addShutdownHook (Runtime/getRuntime) (Thread. shutdown!))
            (log! "started")
            (try
              (startup-notify-pending! roles socket)
              ;; The heartbeat file and log line (every cycle, BL-675) let the
              ;; cron-side freshness checker and supervisor detect a hung
              ;; daemon; a post-mortem sees liveness up to the moment of death
              ;; (BL-061).
              (loop [cycle 0]
                (when (and (not @stopping?) (not (fs/exists? stop-file)))
                  ;; BL-789 (2026-08-02 Mac host-switch hotfix): a heartbeat
                  ;; ALSO lands here, before any of this cycle's work runs -
                  ;; not only at the end below. Mac cycles have been observed
                  ;; at 140-232s; without a start-of-cycle pulse a merely-slow
                  ;; cycle and a genuinely wedged one both look identical to
                  ;; the freshness checker (silence past threshold) until the
                  ;; whole cycle finishes.
                  (spit (str heartbeat-file) (str (now) "\n"))
                  (when (zero? (mod cycle heartbeat-log-every-cycles))
                    (log! "heartbeat" (str "cycle=" cycle "-start")))
                  ;; BL-967: the per-tick phases carry timeout ATTRIBUTION
                  ;; only - no boundary lines (invariant 2's bounded volume:
                  ;; boundaries are heavy-cycle only, never the 1s ticks).
                  (reset! daemon-cycle-guard-lib/current-context "delivery")
                  (poll-once!)
                  (reset! daemon-cycle-guard-lib/current-context "canary-sweep")
                  (try
                    (canary-sweep!)
                    (catch Exception e
                      (log! "canary-sweep-error" (.getMessage e))))
                  (reset! daemon-cycle-guard-lib/current-context "outside-sweep")
                  ;; BL-146: chase/nudge sweep runs on its own cadence,
                  ;; sharing this single process/thread with delivery -
                  ;; exactly one process now owns both duties.
                  (when (zero? (mod cycle chase-sweep-every-cycles))
                    ;; BL-617: chase/dispatch-gap/unassigned-active/open-slot
                    ;; all send WAKES (tmux pokes, rotate/respawn, or notes
                    ;; that would themselves wake the coordinator) - every one
                    ;; suppressed while any pause is active, same freeze as
                    ;; poll-once!'s delivery gate above. Sibling sweeps below
                    ;; this block (briefing/context-clear/dead-letter/
                    ;; resource/push/fleet-status/answer-drain) are out of
                    ;; this ticket's scope (BL-617 notes: "load-bearing scope
                    ;; - verified gap" names only delivery/chase/dispatch/
                    ;; open-slot) and are exempt ONLY from this pause gate —
                    ;; they still share the chase-sweep-every-cycles gate
                    ;; above (fire every ~10 polled cycles at best, and
                    ;; stretch further under load: sweeps in this block run
                    ;; serially, and whole cycles have been observed at
                    ;; 140-232s on Mac — see the BL-789 note at the loop
                    ;; head). "Unconditional" here means
                    ;; pause-exempt, never every-tick (BL-882).
                    (when-not (outbound-wakes-suppressed?)
                      (run-sweep! "chase-sweep"
                          #(chase-sweep! (load-roles) socket))
                      ;; BL-222: dispatch-gap sweep shares the same cadence -
                      ;; no separate timeout, reusing the existing chase
                      ;; interval per the ticket.
                      (run-sweep! "dispatch-gap-sweep"
                          #(dispatch-gap-sweep! (load-roles)))
                      (run-sweep! "unassigned-active-nudge-sweep"
                          #(unassigned-active-nudge-sweep! (load-roles)))
                      (run-sweep! "open-slot-nudge-sweep"
                          #(open-slot-nudge-sweep! (load-roles)))
                      ;; BL-719: dropped-parcel sweep shares the same
                      ;; cadence as its dispatch-gap/open-slot siblings.
                      (run-sweep! "dropped-parcel-sweep"
                          #(dropped-parcel-sweep! (load-roles)))
                      ;; BL-1104: landed-but-open shares the same cadence —
                      ;; name MUST be the literal `landed-but-open` (required_wiring).
                      (run-sweep! "landed-but-open"
                          #(landed-but-open-sweep! (load-roles)))
                      ;; BL-678: batch-claim-progress suspect nudge shares
                      ;; the same cadence as its dropped-parcel sibling.
                      (run-sweep! "batch-claim-progress-sweep"
                          #(batch-claim-progress-sweep! (load-roles))))
                    ;; BL-577: flow watchdog sweep shares the same cadence,
                    ;; but runs UNCONDITIONALLY (outside the
                    ;; outbound-wakes-suppressed? gate above) - it emits no
                    ;; tmux wake, only a durable Telegram alarm, and must
                    ;; alarm precisely when the swarm is stalled/paused, not
                    ;; go quiet alongside the wake suppression.
                    (run-sweep! "flow-watchdog-sweep"
                        #(flow-watchdog-sweep! (load-roles) socket))
                    ;; BL-669: outage failover — certified substitute at idle only.
                    (run-sweep! "outage-driven-seat-failover"
                        #(outage-driven-seat-failover-sweep! (load-roles) socket))
                    ;; BL-839: master-checkout-drift sweep shares the same
                    ;; cadence, runs UNCONDITIONALLY for the same reason
                    ;; flow-watchdog-sweep! above does - a read-only alarm
                    ;; must fire regardless of any pause/wake-suppression
                    ;; state, not go quiet alongside it.
                    (run-sweep! "master-checkout-drift-sweep"
                        #(master-checkout-drift-sweep!))
                    ;; BL-1123: bare=true / tip-floor — unconditional like drift.
                    (run-sweep! "master-checkout-integrity-sweep"
                        #(master-checkout-integrity-sweep!))
                    ;; BL-679: ambulance auto-exit sweep shares the same
                    ;; cadence, runs UNCONDITIONALLY for the same reason
                    ;; flow-watchdog-sweep!/master-checkout-drift-sweep!
                    ;; above do - invariant 2 (a starved ambulance must
                    ;; release, never wait out an unrelated pause) must hold
                    ;; regardless of any pause/wake-suppression state.
                    (run-sweep! "ambulance-auto-exit-sweep"
                        #(ambulance-auto-exit-sweep!))
                    ;; BL-897: ensures the shared lifecycle snapshot both
                    ;; briefing sweeps below read is fresh, sharing the same
                    ;; cadence - unconditional and cheap after the first
                    ;; tick of a new UTC day (see ensure-lifecycle-snapshot!).
                    (run-sweep! "ensure-lifecycle-snapshot"
                        #(ensure-lifecycle-snapshot!))
                    ;; BL-976: keyless-email alert sweep shares the same
                    ;; cadence and runs UNCONDITIONALLY (same posture as
                    ;; flow-watchdog-sweep! above) - the alert must land
                    ;; within the generation's FIRST sweep cycle even when
                    ;; no briefing is mailable, and its own one-shot atom
                    ;; keeps every later cycle a cheap conf-slurp no-op.
                    (run-sweep! "email-keyless-alert-sweep"
                        #(email-keyless-alert-sweep!))
                    ;; BL-214: briefing-email sweep shares the same cadence -
                    ;; no separate timeout, same rationale as BL-222 above.
                    (run-sweep! "briefing-email-sweep"
                        #(briefing-email-sweep!))
                    ;; BL-258: briefing-generation sweep shares the same
                    ;; cadence - no separate timeout, same rationale as
                    ;; BL-222/BL-214 above.
                    (run-sweep! "briefing-generation-sweep"
                        #(briefing-generation-sweep! (load-roles) socket))
                    ;; BL-309: closing-context-clear sweep shares the same
                    ;; cadence - no separate timeout, same rationale as
                    ;; BL-222/BL-214/BL-258 above.
                    (run-sweep! "closing-context-clear-sweep"
                        #(closing-context-clear-sweep! (load-roles) socket))
                    ;; BL-316: generalized per-role context-clear sweep
                    ;; shares the same cadence - no separate timeout, same
                    ;; rationale as BL-222/BL-214/BL-258/BL-309 above.
                    (run-sweep! "role-context-clear-sweep"
                        #(role-context-clear-sweep! (load-roles) socket))
                    ;; BL-353: dead-letter-notify sweep shares the same
                    ;; cadence - no separate timeout, same rationale as
                    ;; BL-222/BL-214/BL-258/BL-309/BL-316 above.
                    (run-sweep! "dead-letter-notify-sweep"
                        #(dead-letter-notify-sweep!))
                    ;; BL-350: resource-sample sweep shares the same cadence -
                    ;; no separate timeout, same rationale as BL-222/BL-214/
                    ;; BL-258/BL-309/BL-316/BL-339/BL-353 above.
                    (run-sweep! "resource-sample-sweep"
                        #(resource-sample-sweep!))
                    ;; BL-665: context-telemetry producer shares the same
                    ;; cadence — idempotent dedupe makes every-tick safe.
                    (run-sweep! "context-telemetry-producer-sweep"
                        #(context-telemetry-producer-sweep!))
                    ;; BL-356: push sweep shares the same cadence - no
                    ;; separate timeout, same rationale as BL-222/BL-214/
                    ;; BL-258/BL-309/BL-316/BL-339/BL-353/BL-350 above.
                    (run-sweep! "push-sweep"
                        #(push-sweep!))
                    ;; BL-891: master-main-reconcile sweep shares the same
                    ;; cadence - no separate timeout, same rationale as
                    ;; BL-222/BL-214/BL-258/BL-309/BL-316/BL-339/BL-353/
                    ;; BL-350/BL-356 above. Mirror-image direction of
                    ;; BL-356's push-sweep! immediately above (origin ->
                    ;; local instead of local -> origin); already carries
                    ;; its own try/catch inside master-main-reconcile-
                    ;; sweep! itself but wrapped again here for the same
                    ;; belt-and-suspenders reason every sibling sweep in
                    ;; this cadence block is.
                    (run-sweep! "master-main-reconcile-sweep"
                        #(master-main-reconcile-sweep!))
                    ;; BL-668: post-QA role-branch sweep shares the same cadence
                    ;; as master-main-reconcile immediately above — fast-forward
                    ;; clean pipeline role branches after origin/main advances.
                    (run-sweep! "post-qa-branch-sweep"
                        #(post-qa-branch-sweep-sweep!))
                    (run-sweep! "main-sync-deadlock-sweep"
                        #(main-sync-deadlock-sweep!))
                    ;; BL-437: fleet-status sweep shares the same cadence -
                    ;; no separate timeout, same rationale as BL-222/BL-214/
                    ;; BL-258/BL-309/BL-316/BL-339/BL-353/BL-350/BL-356
                    ;; above. fleet-status-sweep! already carries its own
                    ;; try/catch (mirroring the shell-out CLIs' own
                    ;; degrade-never-crash posture), but wrapped again here
                    ;; for the same belt-and-suspenders reason every sibling
                    ;; sweep in this cadence block is.
                    (run-sweep! "fleet-status-sweep"
                        #(fleet-status-sweep!))
                    ;; BL-440: answer-file-drain sweep shares the same
                    ;; cadence - no separate timeout, same rationale as
                    ;; BL-222/BL-214/BL-258/BL-309/BL-316/BL-339/BL-353/
                    ;; BL-350/BL-356/BL-437 above.
                    (run-sweep! "answer-file-drain-sweep"
                        #(answer-file-drain-sweep!))
                    ;; BL-423: pause-auto-resume sweep shares the same
                    ;; cadence - no separate timeout, same rationale as
                    ;; BL-222/BL-214/BL-258/BL-309/BL-316/BL-339/BL-353/
                    ;; BL-350/BL-356/BL-437/BL-440 above.
                    (run-sweep! "pause-auto-resume-sweep"
                        #(pause-auto-resume-sweep!))
                    ;; BL-617: cooldown sweep shares the same cadence - no
                    ;; separate timeout, same rationale as BL-222/BL-214/
                    ;; BL-258/BL-309/BL-316/BL-339/BL-353/BL-350/BL-356/
                    ;; BL-437/BL-440/BL-423 above.
                    (run-sweep! "cooldown-sweep"
                        #(cooldown-sweep!)))
                  (spit (str heartbeat-file) (str (now) "\n"))
                  (when (zero? (mod cycle heartbeat-log-every-cycles))
                    (log! "heartbeat" (str "cycle=" cycle)))
                  (Thread/sleep poll-ms)
                  (recur (inc cycle))))
              (finally
                (delete-own-pid-file!)
                (log! "stopped")))))))))

(-main)
