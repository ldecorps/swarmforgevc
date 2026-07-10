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

(def state-dir (fs/path project-root ".swarmforge"))
(def daemon-dir (fs/path state-dir "daemon"))
(def roles-file (fs/path state-dir "roles.tsv"))
(def socket-file (fs/path state-dir "tmux-socket"))
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
                  :on-stuck-escalation! (fn [role escalated?] (chase-sweep-lib/write-escalation! (str daemon-dir) role escalated?))
                  :log-telemetry! (fn [event at-ms]
                                     (try (log-chaser-telemetry! event at-ms)
                                          (catch Exception e (log! "telemetry-error" (:type event) (.getMessage e)))))}]
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
                        (log! "dispatch-gap-sweep-error" (.getMessage e)))))
                  (spit (str heartbeat-file) (str (now) "\n"))
                  (when (zero? (mod cycle heartbeat-log-every-cycles))
                    (log! "heartbeat" (str "cycle=" cycle)))
                  (Thread/sleep poll-ms)
                  (recur (inc cycle))))
              (finally
                (delete-own-pid-file!)
                (log! "stopped")))))))))

(-main)
