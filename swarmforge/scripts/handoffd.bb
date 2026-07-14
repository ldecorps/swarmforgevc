#!/usr/bin/env bb

;; Subprocess calls use babashka.process, NOT clojure.java.shell: bb's
;; clojure.java.shell shim can deadlock reading subprocess streams (observed
;; hanging notify! mid-delivery and silently stalling the whole swarm, BL-061).
(ns handoffd
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.java.io :as io]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "chase_sweep_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "agent_runtime_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "agent_runtime_inject.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_alarm_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "briefing_email_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "briefing_generation_schedule_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "banked_briefing_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "operator_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "closing_context_clear_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "standing_rule_violations_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "standing_rule_violations_files.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "stuck_escalation_email_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "push_sweep_lib.bb")))

(def poll-ms 1000)
(def wake-message agent-runtime-lib/default-wake-chat-message)

;; BL-146: single-daemon consolidation. Chase/nudge sweeps run every
;; chase-sweep-every-cycles poll cycles (poll-ms apart) - the same babashka
;; process that already owns delivery now also owns liveness, so the
;; extension host becomes a pure observer instead of running its own
;; setInterval sweep.
(def chase-sweep-every-cycles 5)
(def chase-sweep-config
  {:chaseIntervalSeconds 5
   :chaseTimeoutSeconds 30
   :maxChases 3
   :stuckInProcessTimeoutSeconds 60
   :respawnCooldownSeconds 300
   :chaseBackoffBaseSeconds 30
   :chaseBackoffMaxSeconds 300})

(defn usage []
  (binding [*out* *err*]
    (println "Usage: handoffd.bb <project-root>"))
  (System/exit 1))

(def project-root
  (or (first *command-line-args*) (usage)))

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
(def heartbeat-log-every-cycles 60)
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
  (let [content (slurp (str path))
        [header body] (str/split content #"\n\n" 2)
        headers (into {}
                      (for [line (str/split-lines header)
                            :let [[k v] (str/split line #": " 2)]
                            :when (and k v)]
                        [k v]))]
    {:headers headers
     :body (or body "")
     :content content}))

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
  (apply process/sh "tmux" args))

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
  (agent-runtime-inject/notify-agent! socket session (or agent "claude")
                                        :log-fn (fn [tag sess detail] (log! tag sess detail))
                                        :script-rel-path agent-runtime-lib/ready-script-rel-path))

(defn maybe-notify!
  "Tmux wake after mailbox delivery. Skipped when SWARMFORGE_MAILBOX_ONLY=1."
  [socket session role recipient-path agent]
  (if (tmux-inject-disabled?)
    (log! "delivered-mailbox-only" role (str recipient-path))
    (notify! socket session agent)))

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
  (let [filename (fs/file-name path)
        message (parse-message path)
        headers (:headers message)
        recipients (some-> (get headers "to") (str/split #",") seq)]
    (if-not recipients
      (fail! path "missing to header")
      (do
        (doseq [recipient recipients]
          (let [role-info (get roles recipient)]
            (when-not role-info
              (throw (ex-info (str "unknown recipient " recipient) {:recipient recipient})))
            (let [target (target-path role-info filename recipient)
                  delivered (add-delivery-headers message recipient)]
              (fs/create-dirs (fs/parent target))
              (when-not (fs/exists? target)
                (spit (str target) (render-message (:headers delivered) (:body delivered))))
              (maybe-notify! socket (:session role-info) recipient (str target) (:agent role-info)))))
        (when (= "rule_proposal" (get headers "type"))
          (append-rule-proposal! headers))
        (move-with-collision path (sent-dir (get roles sender-role)))
        (log! "delivered" (str path))))))

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

(defn startup-notify-pending! [roles socket]
  (when-not (tmux-inject-disabled?)
    (doseq [[_ role-info] roles
            :when (seq (inbox-new-files role-info))]
      (log! "startup-notify" (:role role-info))
      (try
        (notify! socket (:session role-info) (:agent role-info))
        (catch Exception e
          (log! "startup-notify-error" (:role role-info) (.getMessage e)))))))

(defn poll-once! []
  (let [roles (load-roles)
        socket (str/trim (slurp (str socket-file)))]
    (doseq [[role role-info] roles
            path (or (outbox-files role-info) [])]
      (try
        (deliver! roles socket role path)
        (catch Exception e
          (log! "error" (str path) (.getMessage e))
          (if (already-archived? role-info (fs/file-name path))
            (do
              (log! "already-archived" (str path))
              ;; The duplicate outbox copy is confirmed delivered (its
              ;; twin already landed in sent/); archive it too instead of
              ;; leaving it to be reprocessed and re-fail every poll cycle.
              (try
                (move-with-collision path (sent-dir role-info))
                (catch Exception _ignored nil)))
            (fail! path (.getMessage e))))))))

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

(defn own-pid [] (.pid (java.lang.ProcessHandle/current)))

(defn pid-alive? [pid]
  (when pid
    (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.isAlive))))

(defn process-command-line [pid]
  (let [{:keys [out exit]} (process/sh "ps" "-o" "command=" "-p" (str pid))]
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
  (loop []
    (when-not (try
                (fs/create-dir pid-lock-dir)
                true
                (catch java.nio.file.FileAlreadyExistsException _ false))
      (Thread/sleep 50)
      (recur)))
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
  (let [pane (try (capture-pane-lines socket (:session role-info) 50) (catch Exception _ ""))
        outbox-dir (handoff-lib/mailbox-dir role-info :outbox)
        sent-dir* (handoff-lib/mailbox-dir role-info :sent)
        outbox-activity-ms (apply max 0
                                   (for [d [outbox-dir sent-dir*] :when (fs/exists? d)]
                                     (.toMillis (fs/last-modified-time d))))]
    (chase-sweep-lib/track-pane-activity! (:role role-info) pane outbox-activity-ms now-ms)))

(defn do-respawn!
  "Busy-vs-wedged precheck (BL-137/BL-147 parity): never types/respawns into
   a pane showing Claude Code's busy footer. Otherwise force-relaunches the
   role's persisted launch script in place, the same tmux respawn-pane -k
   invocation launch_role/swarm_ensure.bb already use."
  [role-info socket]
  (let [session (:session role-info)
        pane (try (capture-pane-text socket session) (catch Exception _ ""))]
    (if (chase-sweep-lib/actively-processing? pane)
      (log! "chase-respawn-skip-busy" (:role role-info))
      (let [launch-script (fs/path (:worktree-path role-info) ".swarmforge" "launch" (str (:role role-info) ".sh"))]
        (log! "chase-respawn" (:role role-info))
        (tmux! "-S" socket "respawn-pane" "-k" "-t" session (str "zsh '" launch-script "'"))))))

(defn write-chase-status! [now-ms]
  (fs/create-dirs daemon-dir)
  (let [existing (try (json/parse-string (slurp (str duties-file)) true) (catch Exception _ {}))
        updated (assoc existing
                       :pid (own-pid)
                       :delivery {:last_sweep_at (now)}
                       :chase {:last_sweep_at (now)})]
    (spit (str duties-file) (json/generate-string updated))))

(defn role-inboxes-for-chase [roles]
  (for [[role role-info] roles]
    {:role role
     :inbox-new-dir (str (handoff-lib/mailbox-dir role-info :new))
     :in-process-dir (str (handoff-lib/mailbox-dir role-info :in_process))}))

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

(defn stuck-escalation-email-sweep! [role escalated? now-ms]
  (try
    (stuck-escalation-email-lib/sweep!
     role escalated? now-ms (str daemon-dir) escalation-alarm-retry-config
     {:send-email! send-escalation-alarm-email!
      :log! (fn [& parts] (apply log! parts))})
    (catch Exception e
      (log! "stuck-escalation-email-error" role (.getMessage e)))))

(defn chase-sweep! [roles socket]
  (let [now-ms (System/currentTimeMillis)
        adapters {:get-liveness get-liveness
                  :send-wake-up! (fn [role]
                                    (when-not (tmux-inject-disabled?)
                                      (try (notify! socket (:session (get roles role)) (:agent (get roles role)))
                                           (catch Exception e (log! "chase-wake-error" role (.getMessage e))))))
                  :trigger-respawn! (fn [role]
                                       (try (do-respawn! (get roles role) socket)
                                            (catch Exception e (log! "chase-respawn-error" role (.getMessage e)))))
                  :log-dead-letter! (fn [role path] (log! "dead-letter" role (fs/file-name path)))
                  :get-last-activity-ms (fn [role] (get-last-activity-ms (get roles role) socket now-ms))
                  :on-stuck-escalation! (fn [role escalated?]
                                          (chase-sweep-lib/write-escalation! (str daemon-dir) role escalated?)
                                          (stuck-escalation-email-sweep! role escalated? now-ms))
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
                  (fn [role until-ms] (chase-sweep-lib/mark-rate-limit-cooldown-woken! (str state-dir) role until-ms))}]
    (chase-sweep-lib/run-sweep! (role-inboxes-for-chase roles) now-ms chase-sweep-config adapters)
    (write-chase-status! now-ms)))

;; ── BL-222: dispatch-gap sweep - the daemon's third duty ────────────────────
;; Runs on the SAME cadence as chase-sweep! above (no separate timeout, per
;; the ticket) since it's the daemon (never coordinator self-polling) that
;; already runs unattended. chase_sweep_lib.bb owns the pure decision plus
;; the fixture-testable scanning; everything below is the thin, environment-
;; specific wiring (project paths, the actual subprocess send) that mirrors
;; how chase-sweep!'s adapters wire pure decisions to real tmux/heartbeat.

(defn active-backlog-dir [] (fs/path project-root "backlog" "active"))

(defn dispatch-gap-scan-dirs [roles]
  (vec (for [[_ role-info] roles
             state [:new :in_process :completed :sent :outbox]]
         (str (handoff-lib/mailbox-dir role-info state)))))

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
  (let [draft (write-scratch-draft! (chase-sweep-lib/dispatch-gap-draft-lines item))
        env (merge (into {} (System/getenv)) {"SWARMFORGE_ROLE" "coordinator"})
        ;; process/sh's varargs form (cmd arg1 arg2 opts-map) silently drops
        ;; :dir/:env overrides - only the [cmd & args] vector form applies
        ;; them (confirmed empirically). Must use the vector form here:
        ;; auto-route! only works at all if SWARMFORGE_ROLE actually
        ;; resolves to "coordinator" inside the subprocess.
        result (process/sh ["bb" (swarm-handoff-script) (str draft)] {:dir (str project-root) :env env})]
    (if (zero? (:exit result))
      (log! "dispatch-gap-autoroute" (:id item) (:assigned-to item))
      (log! "dispatch-gap-autoroute-error" (:id item) (:assigned-to item) (str (:err result))))))

(defn dispatch-gap-sweep! [roles]
  (doseq [item (chase-sweep-lib/dispatch-gap-items (active-backlog-dir) (dispatch-gap-scan-dirs roles))]
    (try
      (auto-route! item)
      (catch Exception e
        (log! "dispatch-gap-autoroute-error" (:id item) (:assigned-to item) (.getMessage e))))))

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

;; BL-252: shells to the compiled suite-duration-line.js CLI (Babashka has
;; no way to import compiled TS) - reuses computeSuiteDurationTrend/
;; computeSuiteDuration unchanged, the SAME functions already feeding the
;; bridge's /metrics route the holistic UI reads, so the briefing can never
;; disagree with the live UI about what "regressing" means. Must use the
;; [cmd & args] + opts-map form of process/sh, not flat varargs - the
;; latter silently drops :dir (see auto-route!'s own comment above). Any
;; failure (CLI not yet compiled on this checkout, etc.) degrades to
;; omitting the line entirely - never crashes the sweep, never a fabricated
;; value.
(defn suite-duration-briefing-line []
  (try
    (let [cli-path (str (fs/path project-root "extension" "out" "tools" "suite-duration-line.js"))
          {:keys [exit out]} (process/sh ["node" cli-path] {:dir (str project-root)})]
      (when (zero? exit) (str/trim out)))
    (catch Exception _ nil)))

;; BL-251: same shell-out pattern as suite-duration-briefing-line above -
;; reuses computeBacklogDashboard's own needsApproval field unchanged, the
;; SAME field backlog.json/the PWA already carry, so the briefing can never
;; disagree with the PWA about what's pending. Any failure degrades to
;; omitting the section entirely - never crashes the sweep.
(defn needs-approval-briefing-section []
  (try
    (let [cli-path (str (fs/path project-root "extension" "out" "tools" "needs-approval-line.js"))
          {:keys [exit out]} (process/sh ["node" cli-path] {:dir (str project-root)})]
      (when (zero? exit) (str/trim out)))
    (catch Exception _ nil)))

;; BL-256: same shell-out pattern as suite-duration-briefing-line/
;; needs-approval-briefing-section above - each CLI reuses existing
;; telemetry unchanged (gitHistoryAdapter.ts + ticketHoldingWindows.ts,
;; stageDwell.ts's own already-shipped stage-dwell-report.js CLI as-is, and
;; swarmMetrics.ts's chaser telemetry), so the briefing can never disagree
;; with the live UI/CLI about what these numbers are. Any failure degrades
;; to omitting the section entirely - never crashes the sweep.
(defn merged-blocked-digest-briefing-section []
  (try
    (let [cli-path (str (fs/path project-root "extension" "out" "tools" "briefing-digest-line.js"))
          {:keys [exit out]} (process/sh ["node" cli-path] {:dir (str project-root)})]
      (when (zero? exit) (str/trim out)))
    (catch Exception _ nil)))

;; Reuses BL-102's own stage-dwell-report.js CLI directly (no new wrapper
;; needed - its default text output is already briefing-ready).
(defn stage-dwell-briefing-section []
  (try
    (let [cli-path (str (fs/path project-root "extension" "out" "tools" "stage-dwell-report.js"))
          {:keys [exit out]} (process/sh ["node" cli-path] {:dir (str project-root)})]
      (when (zero? exit) (str/trim out)))
    (catch Exception _ nil)))

(defn chase-trend-briefing-section []
  (try
    (let [cli-path (str (fs/path project-root "extension" "out" "tools" "chase-trend-line.js"))
          {:keys [exit out]} (process/sh ["node" cli-path] {:dir (str project-root)})]
      (when (zero? exit) (str/trim out)))
    (catch Exception _ nil)))

;; BL-263: same shell-out pattern as needs-approval-briefing-section above -
;; reuses computeBacklogDashboard's own notDoneCount field unchanged, the
;; SAME field backlog.json/the PWA already carry, so the briefing can never
;; disagree with the PWA about the not-done total. Any failure degrades to
;; omitting the line entirely - never crashes the sweep.
(defn not-done-count-briefing-line []
  (try
    (let [cli-path (str (fs/path project-root "extension" "out" "tools" "not-done-count-line.js"))
          {:keys [exit out]} (process/sh ["node" cli-path] {:dir (str project-root)})]
      (when (zero? exit) (str/trim out)))
    (catch Exception _ nil)))

;; BL-337: pure Babashka text-parsing, no compiled TS needed - unlike the
;; *-briefing-line fns above, this reads standing_rule_violations_lib.bb's
;; own scan directly (constitution articles + role prompts), never
;; shelling to node. Any failure (a file unreadable, an unexpected repo
;; layout) degrades to omitting the line entirely - never crashes the
;; sweep, never fabricates a count. File discovery itself is shared with
;; standing_rule_violations_cli.bb via standing_rule_violations_files.bb -
;; both used to carry their own copy of this filter, with the same bug.
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
    (let [cli-path (str (fs/path project-root "extension" "out" "tools" "render-briefing-diagrams.js"))
          {:keys [exit out]} (process/sh ["node" cli-path] {:dir (str project-root)})]
      (when (zero? exit) (json/parse-string out true)))
    (catch Exception _ nil)))

;; Wraps briefing-diagrams-json with briefing_email_lib.bb's pure
;; build-diagram-section - the ONLY :diagram-section adapter shape
;; send-unsent-briefings! expects (BL-260 render-unavailable-degradation-04:
;; nil diagrams still produce a clear no-diagram note, never a crash).
(defn briefing-diagram-section []
  (briefing-email-lib/build-diagram-section (briefing-diagrams-json)))

(defn briefing-email-sweep! []
  (briefing-email-lib/send-unsent-briefings!
   (str briefings-dir)
   {:read-briefing-content (fn [file-name] (slurp (str (fs/path briefings-dir file-name))))
    :send-email! send-configured-briefing-email!
    :diagram-section briefing-diagram-section
    :suite-duration-line suite-duration-briefing-line
    :needs-approval-section needs-approval-briefing-section
    :merged-blocked-digest merged-blocked-digest-briefing-section
    :stage-dwell-section stage-dwell-briefing-section
    :chase-trend-section chase-trend-briefing-section
    :not-done-count-line not-done-count-briefing-line
    :standing-rule-violations-line standing-rule-violations-briefing-line
    :log! (fn [& parts] (apply log! parts))}))

;; BL-339: shells to the compiled notify-recert-batch.js CLI (Babashka has
;; no way to import compiled TS, same posture as the *-briefing-line fns
;; above) - reuses computeRecertBatch unchanged, the SAME data the PWA
;; itself renders, so the Telegram announcement can never disagree with
;; what the human sees when he follows the link. The CLI itself owns the
;; edge-triggered arm/disarm decision and the delivery-based state
;; (BL-345's own "arm on delivery, never on attempt" lesson) - this
;; adapter only owns invoking it. Any failure (CLI not yet compiled, no
;; TELEGRAM_BOT_TOKEN in this daemon's env) degrades to a no-op - never
;; crashes the sweep, never fabricates a sent notification.
(defn recert-notify-sweep! []
  (try
    (let [cli-path (str (fs/path project-root "extension" "out" "tools" "notify-recert-batch.js"))
          {:keys [exit out]} (process/sh ["node" cli-path] {:dir (str project-root)})]
      (when (zero? exit)
        (log! "recert-notify" (str/trim out))))
    (catch Exception e
      (log! "recert-notify-sweep-error" (.getMessage e)))))

;; BL-353: shells to the compiled notify-dead-letters.js CLI, same posture
;; as recert-notify-sweep! above - ports the retired legacy narrator's
;; "dead-letter" signal (telegramNarrator.ts:diffNewDeadLetters) onto the
;; headless front desk, into BL-346's reserved Operator topic (a dead
;; letter is not reliably ticket-scoped, unlike a NeedsApproval gate). The
;; CLI itself owns the growing-set announced state and delivery-based
;; arming; this adapter only owns invoking it.
(defn dead-letter-notify-sweep! []
  (try
    (let [cli-path (str (fs/path project-root "extension" "out" "tools" "notify-dead-letters.js"))
          {:keys [exit out]} (process/sh ["node" cli-path] {:dir (str project-root)})]
      (when (zero? exit)
        (log! "dead-letter-notify" (str/trim out))))
    (catch Exception e
      (log! "dead-letter-notify-sweep-error" (.getMessage e)))))

;; BL-350 (BL-336 finding H1): shells to the compiled sample-resources.js
;; CLI, same posture as dead-letter-notify-sweep!/recert-notify-sweep!
;; above - reuses BL-264's startResourceSampler pid-resolution/append path
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
    (let [cli-path (str (fs/path project-root "extension" "out" "tools" "sample-resources.js"))
          {:keys [exit out]} (process/sh ["node" cli-path] {:dir (str project-root)})]
      (when (zero? exit)
        (log! "resource-sample" (str/trim out))))
    (catch Exception e
      (log! "resource-sample-sweep-error" (.getMessage e)))))

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
    (process/sh ["git" "fetch" "origin" "main"] {:dir (str project-root)})
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
  (let [{:keys [exit out]} (process/sh ["git" "rev-list" "--left-right" "--count" "origin/main...main"]
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
  (let [{:keys [exit err]} (process/sh ["git" "push" "origin" "main"] {:dir (str project-root)})]
    (if (zero? exit)
      {:success true}
      {:success false :error (str/trim (or err ""))})))

(defn push-sweep! []
  (try
    (push-sweep-lib/sweep!
     (System/currentTimeMillis) (str daemon-dir) push-sweep-retry-config
     {:rev-counts! push-sweep-rev-counts!
      :push! push-sweep-push!
      :send-push-alarm!
      (fn [attempts]
        (send-push-alarm-email!
         "SwarmForge: main is not reaching origin"
         (str "Local `main` has failed to push to origin " attempts " times in a row. "
              "The swarm's committed work is not reaching origin - check network/auth "
              "and push by hand if needed.\n")))
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

;; BL-258: headless, host-independent morning trigger for briefing
;; GENERATION (complements briefing-email-sweep! above, which only handles
;; the SEND of an already-committed file). Reads the configured morning
;; time the same way send-configured-briefing-email! reads notify_email_to
;; above - daemon_alarm_lib.bb's shared parse-conf, one convention for every
;; daemon-level swarmforge.conf key.
(defn configured-morning-time []
  (let [conf (daemon-alarm-lib/parse-conf (when (fs/exists? conf-file) (slurp (str conf-file))))]
    (briefing-generation-schedule-lib/parse-morning-time (get conf "briefing_morning_time_utc"))))

;; BL-272: headless entrypoint for BL-213's deterministic cost & health
;; sidecar emitter (extension/src/tools/emit-cost-health-sidecar.ts,
;; compiled to out/tools/emit-cost-health-sidecar.js) - the same
;; compute -> write -> commit path extension.ts's onBriefingDue calls
;; in-process from a VS Code host. A non-zero exit is surfaced as a thrown
;; exception so generate-briefing-if-due!'s own try/catch around
;; :emit-sidecar! stays the single place that makes this best-effort;
;; this adapter does not need its own try/catch.
(defn emit-cost-health-sidecar! []
  (let [cli-path (str (fs/path project-root "extension" "out" "tools" "emit-cost-health-sidecar.js"))
        {:keys [exit out err]} (process/sh ["node" cli-path] {:dir (str project-root)})]
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
          {:keys [exit out]} (process/sh ["git" "log" "--oneline" (str "--since=" since)]
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

(defn briefing-generation-sweep! [roles socket]
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
      :log! (fn [& parts] (apply log! parts))})))

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

;; Shared by every context-clear sweep below (coordinator and per-role,
;; BL-316): both inject via the same agent-runtime-inject/notify-agent!
;; call, differing only in which role-info/socket they target - only
;; :record-clear! differs per sweep, so that stays sweep-local.
(defn context-clear-injectors [socket role-info]
  {:inject-clear! (fn []
                     (agent-runtime-inject/notify-agent!
                      socket (:session role-info) (or (:agent role-info) "claude")
                      :log-fn (fn [tag sess detail] (log! tag sess detail))
                      :text "/clear"))
   :inject-startup-reread! (fn [instruction-text]
                              (agent-runtime-inject/notify-agent!
                               socket (:session role-info) (or (:agent role-info) "claude")
                               :log-fn (fn [tag sess detail] (log! tag sess detail))
                               :text instruction-text))})

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
  (if (tmux-inject-disabled?)
    (log! "role-context-clear-skip-mailbox-only")
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
              ;; The heartbeat file (every cycle) and log line (periodic) let the
              ;; supervisor detect a hung daemon and a post-mortem see liveness up
              ;; to the moment of death (BL-061).
              (loop [cycle 0]
                (when (and (not @stopping?) (not (fs/exists? stop-file)))
                  (poll-once!)
                  (try
                    (canary-sweep!)
                    (catch Exception e
                      (log! "canary-sweep-error" (.getMessage e))))
                  ;; BL-146: chase/nudge sweep runs on its own cadence,
                  ;; sharing this single process/thread with delivery -
                  ;; exactly one process now owns both duties.
                  (when (zero? (mod cycle chase-sweep-every-cycles))
                    (try
                      (chase-sweep! (load-roles) socket)
                      (catch Exception e
                        (log! "chase-sweep-error" (.getMessage e))))
                    ;; BL-222: dispatch-gap sweep shares the same cadence -
                    ;; no separate timeout, reusing the existing chase
                    ;; interval per the ticket.
                    (try
                      (dispatch-gap-sweep! (load-roles))
                      (catch Exception e
                        (log! "dispatch-gap-sweep-error" (.getMessage e))))
                    ;; BL-214: briefing-email sweep shares the same cadence -
                    ;; no separate timeout, same rationale as BL-222 above.
                    (try
                      (briefing-email-sweep!)
                      (catch Exception e
                        (log! "briefing-email-sweep-error" (.getMessage e))))
                    ;; BL-258: briefing-generation sweep shares the same
                    ;; cadence - no separate timeout, same rationale as
                    ;; BL-222/BL-214 above.
                    (try
                      (briefing-generation-sweep! (load-roles) socket)
                      (catch Exception e
                        (log! "briefing-generation-sweep-error" (.getMessage e))))
                    ;; BL-309: closing-context-clear sweep shares the same
                    ;; cadence - no separate timeout, same rationale as
                    ;; BL-222/BL-214/BL-258 above.
                    (try
                      (closing-context-clear-sweep! (load-roles) socket)
                      (catch Exception e
                        (log! "closing-context-clear-sweep-error" (.getMessage e))))
                    ;; BL-316: generalized per-role context-clear sweep
                    ;; shares the same cadence - no separate timeout, same
                    ;; rationale as BL-222/BL-214/BL-258/BL-309 above.
                    (try
                      (role-context-clear-sweep! (load-roles) socket)
                      (catch Exception e
                        (log! "role-context-clear-sweep-error" (.getMessage e))))
                    ;; BL-339: recert-notify sweep shares the same cadence -
                    ;; no separate timeout, same rationale as BL-222/BL-214/
                    ;; BL-258/BL-309/BL-316 above.
                    (try
                      (recert-notify-sweep!)
                      (catch Exception e
                        (log! "recert-notify-sweep-error" (.getMessage e))))
                    ;; BL-353: dead-letter-notify sweep shares the same
                    ;; cadence - no separate timeout, same rationale as
                    ;; BL-222/BL-214/BL-258/BL-309/BL-316/BL-339 above.
                    (try
                      (dead-letter-notify-sweep!)
                      (catch Exception e
                        (log! "dead-letter-notify-sweep-error" (.getMessage e))))
                    ;; BL-350: resource-sample sweep shares the same cadence -
                    ;; no separate timeout, same rationale as BL-222/BL-214/
                    ;; BL-258/BL-309/BL-316/BL-339/BL-353 above.
                    (try
                      (resource-sample-sweep!)
                      (catch Exception e
                        (log! "resource-sample-sweep-error" (.getMessage e))))
                    ;; BL-356: push sweep shares the same cadence - no
                    ;; separate timeout, same rationale as BL-222/BL-214/
                    ;; BL-258/BL-309/BL-316/BL-339/BL-353/BL-350 above.
                    (try
                      (push-sweep!)
                      (catch Exception e
                        (log! "push-sweep-error" (.getMessage e)))))
                  (spit (str heartbeat-file) (str (now) "\n"))
                  (when (zero? (mod cycle heartbeat-log-every-cycles))
                    (log! "heartbeat" (str "cycle=" cycle)))
                  (Thread/sleep poll-ms)
                  (recur (inc cycle))))
              (finally
                (delete-own-pid-file!)
                (log! "stopped")))))))))

(-main)
