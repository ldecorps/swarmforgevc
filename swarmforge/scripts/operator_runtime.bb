#!/usr/bin/env bb

;; Operator v2 — the lightweight, always-alive Operator RUNTIME.
;;
;; This is the cheap half of the split described in operator_lib.bb: a
;; babashka loop that never sleeps indefinitely, owns the timers and
;; heartbeat, publishes status.json, watches tmux + the filesystem +
;; provider state, maintains an event queue, and launches the DISPOSABLE LLM
;; Operator (Claude Opus, via launch_operator.sh, with --remote-control
;; SwarmForge-Operator) ONLY when an event needs reasoning and the provider
;; is available. It performs no reasoning itself — every judgement call is
;; either a pure function in operator_lib.bb or is deferred to the LLM.
;;
;; Structure deliberately mirrors handoffd_supervisor.bb (pid file,
;; heartbeat, status.json, `while (not stop-file)` loop) so it fits the
;; existing daemon conventions and its start/stop story is the same.
;;
;; Usage:
;;   operator_runtime.bb <project-root>              ; run the loop
;;   operator_runtime.bb <project-root> --tick-once  ; a single observe/act tick
;;
;; Tunables via environment (ms unless noted):
;;   OPERATOR_INTERVAL_MS        loop sleep between ticks     (default 30000)
;;   OPERATOR_SWARM_CHECK_MS     periodic swarm-check cadence (default 1800000 = 30m)
;;   OPERATOR_HEARTBEAT          set to 0 to skip heartbeat writes (tests)
;;   OPERATOR_SKIP_LAUNCH        set to 1 to never actually launch the LLM (dry-run)

(ns operator-runtime
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "operator_lib.bb")))
;; BL-281 (reshaped 2026-07-11, bridge-client architecture): Telegram
;; forum-topic threads over the bridge. The runtime NEVER talks to
;; Telegram directly - telegram_topic_lib.bb is now only the pure per-
;; launch dispatch/reply-context logic (topic<->SUP-### demux moved to the
;; Front Desk Bot, a bridge client - extension/src/tools/telegram-front-
;; desk-bot.ts). support_thread_store.bb is the SAME unified SUP-###
;; thread-store fs adapters support_thread.bb (RC channel) and the bridge's
;; new inbound-message route (Telegram channel) both write to, so a thread
;; opened over either channel lives in one store. BL-276: support_lib.bb
;; itself (the pure lib) is now load-file'd directly too, for idle-nudge-
;; sweep!'s own status-transition/idle-decision calls below.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "telegram_topic_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "support_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "support_thread_store.bb")))
;; BL-282: the Operator's long-term memory (durable, generalizable facts,
;; distinct from any subject's per-thread transcript) - reloaded alongside
;; the dispatched subject's transcript on every wake, below.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "operator_memory_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "operator_memory_store.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: operator_runtime.bb <project-root> [--tick-once]"))
  (System/exit 1))

(def project-root (or (first *command-line-args*) (usage)))
(def tick-once? (some #{"--tick-once"} *command-line-args*))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def state-dir (fs/path project-root ".swarmforge"))
(def op-dir (fs/path state-dir "operator"))
(def status-file (fs/path op-dir "status.json"))
(def heartbeat-file (fs/path op-dir "heartbeat"))
(def events-file (fs/path op-dir "events.jsonl"))
(def inflight-file (fs/path op-dir "events.inflight.jsonl"))
(def cooldown-file (fs/path op-dir "cooldown.json"))
(def last-check-file (fs/path op-dir "last-swarm-check"))
(def pid-file (fs/path op-dir "runtime.pid"))
(def operator-pid-file (fs/path op-dir "operator.pid"))
(def stop-file (fs/path op-dir "stop"))
(def command-file (fs/path op-dir "command"))
(def done-file (fs/path op-dir "operator.done"))
(def log-file (fs/path op-dir "runtime.log"))
(def roles-file (fs/path state-dir "roles.tsv"))
(def tmux-socket-file (fs/path state-dir "tmux-socket"))
(def conf-file (fs/path state-dir ".." "swarmforge" "swarmforge.conf"))
(def launch-operator (fs/path script-dir "launch_operator.sh"))

;; The Operator is NOT a swarm agent: it runs on its OWN tmux socket (see
;; launch_operator.sh) and its session/RC name deliberately drop the
;; "swarmforge-" prefix the role agents use, so it reads as the external
;; supervisor it is, never a swarm member.
(def operator-session "operator")
(def operator-rc-name "Operator")
(def operator-socket-file (fs/path op-dir "operator-tmux.sock"))

;; ── BL-281: Telegram forum-topic threads (bridge-client architecture) ────
;; Just the reply-context handoff file now - the runtime never touches
;; Telegram, an offset, or a topic mapping directly (all bot-owned).
(def telegram-reply-context-file (fs/path op-dir "telegram-reply-context.json"))

(defn env-ms [name default]
  (or (some-> (System/getenv name) parse-long) default))

(def interval-ms (env-ms "OPERATOR_INTERVAL_MS" 30000))
(def swarm-check-ms (env-ms "OPERATOR_SWARM_CHECK_MS" 1800000))
(def heartbeat? (not= "0" (System/getenv "OPERATOR_HEARTBEAT")))
(def skip-launch? (= "1" (System/getenv "OPERATOR_SKIP_LAUNCH")))

(defn now-ms [] (System/currentTimeMillis))
(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))
(defn local-offset-ms []
  (-> (java.time.ZoneId/systemDefault)
      (.getRules)
      (.getOffset (java.time.Instant/now))
      (.getTotalSeconds)
      (* 1000)))

(defn log! [& parts]
  (fs/create-dirs op-dir)
  (spit (str log-file) (str (now-iso) " " (str/join " " parts) "\n") :append true))

;; ── atomic-ish writes (same posture as handoffd: whole-file overwrite) ────────

(defn atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path) (str "." (fs/file-name path) ".tmp"))]
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

;; ── process / tmux liveness ───────────────────────────────────────────────────

(defn pid-alive? [pid]
  (when pid
    (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.isAlive))))

(defn read-pid [path]
  (when (fs/exists? path)
    (try (parse-long (str/trim (slurp (str path)))) (catch Exception _ nil))))

(defn tmux-socket []
  (when (fs/exists? tmux-socket-file)
    (str/trim (slurp (str tmux-socket-file)))))

(defn tmux-live-sessions
  "Sessions (windows) tmux currently reports on the swarm socket. Empty when
   the socket is gone or tmux errors — the caller treats that as 'no agents'."
  []
  (if-let [sock (tmux-socket)]
    (let [{:keys [out exit]} (process/sh {:continue true}
                                         "tmux" "-S" sock "list-windows" "-a"
                                         "-F" "#{session_name}")]
      (if (zero? exit)
        (->> (str/split-lines out) (map str/trim) (remove str/blank?) distinct vec)
        []))
    []))

(defn capture-pane-on
  "Last -lines of a session's pane on an explicit socket, or nil when the
   socket is absent/dead or the capture fails."
  [sock session lines]
  (when (and sock (fs/exists? (fs/path sock)))
    (let [{:keys [out exit]} (process/sh {:continue true}
                                         "tmux" "-S" (str sock) "capture-pane" "-p"
                                         "-t" (str session ":0") "-S" (str "-" lines))]
      (when (zero? exit) out))))

(defn capture-pane
  "Capture a role pane on the SWARM socket."
  [session lines]
  (capture-pane-on (tmux-socket) session lines))

(defn tmux-sessions-on
  "Session names tmux reports on the given socket path, [] if socket dead/absent."
  [sock]
  (if (and sock (fs/exists? (fs/path sock)))
    (let [{:keys [out exit]} (process/sh {:continue true}
                                         "tmux" "-S" (str sock) "list-sessions" "-F" "#{session_name}")]
      (if (zero? exit)
        (->> (str/split-lines out) (map str/trim) (remove str/blank?) vec)
        []))
    []))

(defn operator-running?
  "Is the disposable LLM Operator currently alive? Checks the OPERATOR's OWN
   tmux socket (never the swarm socket — the Operator is independent, which is
   what lets it survive and recover a swarm failure) OR its pid file."
  []
  (boolean (or (some #{operator-session} (tmux-sessions-on operator-socket-file))
               (pid-alive? (read-pid operator-pid-file)))))

;; ── event queue (jsonl) ───────────────────────────────────────────────────────

(defn read-events [path]
  (if (fs/exists? path)
    (->> (str/split-lines (slurp (str path)))
         (remove str/blank?)
         (keep (fn [line] (try (json/parse-string line true) (catch Exception _ nil))))
         vec)
    []))

(defn append-event! [event]
  (fs/create-dirs op-dir)
  (spit (str events-file) (str (json/generate-string event) "\n") :append true))

;; BL-281: whole-file overwrite counterpart to append-event! - launch-
;; operator! below uses this to write EXACTLY the selected dispatch batch
;; to inflight-file (never the raw fs/move it used before select-dispatch-
;; batch existed), and to rewrite events-file with only the deferred
;; leftovers.
(defn write-events! [path events]
  (fs/create-dirs (fs/parent path))
  (spit (str path) (str/join "" (map #(str (json/generate-string %) "\n") events))))

(defn enqueue-observed!
  "Append every observed event that survives operator-lib de-dup against what
   is already queued. Returns the number newly enqueued."
  [observed]
  (let [pending (read-events events-file)
        merged (operator-lib/merge-events pending observed)
        added (drop (count pending) merged)]
    (doseq [e added] (append-event! e))
    (count added)))

;; BL-281 (reshaped): the runtime no longer touches Telegram, an offset, or
;; a topic mapping at all - the Front Desk Bot (a bridge client) owns all
;; of that. TELEGRAM_TOPIC_MESSAGE events now arrive in events.jsonl
;; because the BRIDGE's inbound-message route appends them directly
;; (bridgeServer.ts), the same file this runtime already reads via
;; read-events/enqueue-observed! above. The runtime's only remaining
;; Telegram-aware job is per-launch dispatch/reply-context (below, in the
;; launch-operator! section) - it still speaks SUP-### only, never Telegram.

;; ── BL-276: idle-nudge sweep (thread-lifecycle-03/04) ─────────────────────
;; Reuses BL-281's exact reply-relay path (append to the thread transcript
;; + append to the SAME reply outbox the bridge's SSE stream reads) so a
;; nudge reaches the Front Desk Bot the identical way any other Operator
;; reply does - no new comms path, per the ticket's own constraint. This
;; sweep NEVER calls support-lib/resolve-thread - that is thread-
;; lifecycle-02's own separate, human-confirmation-only path
;; (support_thread.bb resolve), proof by construction that idle nudging can
;; never close a thread (thread-lifecycle-01).
(def reply-outbox-file (fs/path op-dir "telegram-reply-outbox.jsonl"))

(defn append-to-reply-outbox! [thread-id text]
  (fs/create-dirs (fs/parent reply-outbox-file))
  (spit (str reply-outbox-file) (str (json/generate-string {"threadId" thread-id "text" text}) "\n") :append true))

(defn idle-nudge-sweep!
  "For every OPEN thread in the unified store, evaluates support-lib/idle-
   nudge-decision (pure, injected now-ms) and posts the nudge (transcript +
   reply outbox) when due. A resolved/closed thread is skipped entirely -
   there is nothing to nudge once a human has confirmed resolution."
  [now-ms]
  (doseq [thread-id (support-thread-store/list-existing-ids! state-dir)]
    (when-let [thread (support-thread-store/read-thread! state-dir thread-id)]
      (when (and (= (:status thread) "open")
                 (= :post-nudge (support-lib/idle-nudge-decision thread now-ms)))
        (let [updated (support-lib/append-message thread support-lib/operator-channel (now-iso) support-lib/idle-nudge-text)]
          (support-thread-store/write-thread! state-dir updated)
          (append-to-reply-outbox! thread-id support-lib/idle-nudge-text)
          (log! "idle-nudge-posted" thread-id))))))

;; ── cooldown / provider state ─────────────────────────────────────────────────

(defn read-cooldown []
  (when (fs/exists? cooldown-file)
    (try (json/parse-string (slurp (str cooldown-file)) true) (catch Exception _ nil))))

(defn write-cooldown! [m] (atomic-spit! cooldown-file (json/generate-string m)))
(defn clear-cooldown! [] (fs/delete-if-exists cooldown-file))

(defn scan-provider-state
  "Look at the agent panes + the operator's own last run for a usage-limit
   banner. Returns {:state :available|:cooldown, :reset-ms N?, :reset-raw s?}.
   Reuses the pure detectors in operator_lib."
  [now]
  (let [existing (read-cooldown)
        ;; still cooling if a recorded reset has not yet elapsed
        cooling-recorded? (and existing (:reset_ms existing)
                               (not (operator-lib/cooldown-elapsed? (:reset_ms existing) now)))
        agent-panes (->> (operator-lib/parse-roles-tsv
                          (when (fs/exists? roles-file) (slurp (str roles-file))))
                         (map :session) distinct
                         (keep #(capture-pane % 40)))
        ;; the Operator's own pane lives on its dedicated socket, not the swarm's
        op-pane (capture-pane-on operator-socket-file operator-session 40)
        panes (keep identity (cons op-pane agent-panes))
        limited-text (some #(when (operator-lib/usage-limited? %) %) panes)]
    (cond
      limited-text
      (let [clock (operator-lib/parse-reset-clock limited-text)
            reset-ms (when clock (operator-lib/reset-epoch-ms clock now (local-offset-ms)))]
        {:state :cooldown :reset-ms reset-ms
         :reset-raw (some-> (re-find #"(?i)resets?[^\n]*" limited-text) str/trim)})

      cooling-recorded?
      {:state :cooldown :reset-ms (:reset_ms existing) :reset-raw (:reset_raw existing)}

      :else {:state :available})))

;; ── timer ─────────────────────────────────────────────────────────────────────

(defn last-swarm-check-ms []
  (read-pid last-check-file)) ; reuse: file just holds an epoch-ms integer

(defn record-swarm-check! [ms] (atomic-spit! last-check-file (str ms)))

;; ── filesystem signals ────────────────────────────────────────────────────────

(defn file-age-ms [path]
  (when (fs/exists? path)
    (- (now-ms) (.toMillis (fs/last-modified-time path)))))

(defn coordinator-inbox-has-fresh?
  "A handoff landed for the coordinator within the last interval → TASK_ARRIVED.
   Cheap mtime probe on the coordinator inbox/new dir."
  []
  (let [inbox (fs/path state-dir "handoffs" "coordinator" "inbox" "new")]
    (and (fs/exists? inbox)
         (some (fn [f] (and (str/ends-with? (fs/file-name f) ".handoff")
                            (when-let [a (file-age-ms f)] (< a interval-ms))))
               (fs/list-dir inbox)))))

;; ── launching the disposable LLM Operator ─────────────────────────────────────

(defn dispatch-subject-of
  "The :subject (thread id) of the first TELEGRAM_TOPIC_MESSAGE event in a
   dispatch batch, or nil when the batch carries none - used to decide
   whether a reply-context file needs writing."
  [dispatch-events]
  (some :subject (filter #(= (:type %) "TELEGRAM_TOPIC_MESSAGE") dispatch-events)))

(defn write-telegram-reply-context!
  "BL-281 telegram-topic-03/telegram-topic-04 + BL-282 operator-memory-02:
   pre-fetches the ONE dispatched subject's reloaded transcript
   (telegram-topic-lib/reply-context-for) TOGETHER WITH the Operator's
   long-term memory facts (operator-memory-lib/facts-for-wake - the SAME
   full set for every subject, MVP: no ranking), and writes them into one
   file the disposable Operator's kickoff can reference - the structural
   guarantee that a wake for one subject has no path to another subject's
   TRANSCRIPT (telegram-topic-04), while the durable facts alongside it are
   intentionally global (operator-memory-02/03: durable facts are shared
   context, never a per-subject transcript leak - the two are kept in
   clearly separate fields here, never merged into one blob). No topic id
   here (reshaped architecture) - the runtime speaks SUP-### only; the
   Front Desk Bot owns the topic mapping and resolves it itself once the
   reply reaches it over SSE."
  [thread-id]
  (atomic-spit! telegram-reply-context-file
                (json/generate-string
                 {:thread-id thread-id
                  :transcript (telegram-topic-lib/reply-context-for thread-id (support-thread-store/adapters-for state-dir))
                  :long-term-memory (operator-memory-lib/facts-for-wake (operator-memory-store/read-store! state-dir))})))

(defn launch-operator!
  "Move the pending queue aside so new events accumulate cleanly, then spawn
   launch_operator.sh which starts the Opus Operator (with --remote-control)
   in the swarm's tmux, pointed at the inflight events. Never launches a
   second one (caller already checked operator-running?).

   BL-281: the pending queue is no longer moved wholesale - select-dispatch-
   batch first splits off AT MOST ONE Telegram subject's events (every
   other pending event type dispatches together unchanged); only the
   selected :dispatch batch becomes inflight, :deferred events are written
   back to events-file for a later tick. When the dispatch batch is a
   Telegram wake, its reply context is pre-fetched and written alongside."
  []
  (let [pending (read-events events-file)
        {:keys [dispatch deferred]} (telegram-topic-lib/select-dispatch-batch pending)
        telegram-subject (dispatch-subject-of dispatch)]
    (fs/delete-if-exists events-file)
    (write-events! inflight-file dispatch)
    (doseq [e deferred] (append-event! e))
    (if telegram-subject
      (write-telegram-reply-context! telegram-subject)
      (fs/delete-if-exists telegram-reply-context-file)))
  (log! "launch-operator" "inflight=" (str (when (fs/exists? inflight-file)
                                             (count (read-events inflight-file)))))
  (if skip-launch?
    (log! "launch-operator" "SKIPPED (OPERATOR_SKIP_LAUNCH=1)")
    (process/process ["bash" (str launch-operator) project-root (str inflight-file)]
                     {:out :inherit :err :inherit})))

(defn kill-operator-window!
  "Tear down the Operator's own tmux session (on its dedicated socket). Used
   when the Operator signalled completion (operator.done) but its interactive
   --remote-control session is still sitting at a prompt — the runtime owns
   disposal so the LLM half stays truly disposable."
  []
  (when (fs/exists? operator-socket-file)
    (process/sh {:continue true} "tmux" "-S" (str operator-socket-file)
                "kill-session" "-t" operator-session)))

(defn reap-finished-operator!
  "Retire a completed Operator run. Two triggers:
   1. the Operator wrote operator.done (its instructed last act) — kill its
      lingering RC window, so it becomes not-running;
   2. the Operator window/pid is already gone.
   In either case, once it is no longer running its inflight events are
   archived. Inflight stays put until a run completes, so a crash never loses
   the queue permanently."
  []
  (when (fs/exists? done-file)
    (log! "reap-operator" "operator.done seen; killing RC window")
    (kill-operator-window!)
    (fs/delete-if-exists done-file))
  (when (and (fs/exists? inflight-file) (not (operator-running?)))
    (let [done-dir (fs/path op-dir "events-done")]
      (fs/create-dirs done-dir)
      (fs/move inflight-file
               (fs/path done-dir (str "events-" (now-ms) ".jsonl"))
               {:replace-existing true})
      (fs/delete-if-exists operator-pid-file)
      ;; BL-281: a stale reply-context file must never carry over into the
      ;; NEXT (possibly non-Telegram) run.
      (fs/delete-if-exists telegram-reply-context-file)
      (log! "reap-operator" "inflight retired"))))

;; ── status ────────────────────────────────────────────────────────────────────

(defn write-status! [m]
  (atomic-spit! status-file (str (json/generate-string (assoc m :updated_at (now-iso))) "\n")))

;; ── one tick ──────────────────────────────────────────────────────────────────

(defn tick! []
  (when heartbeat? (atomic-spit! heartbeat-file (now-iso)))
  (let [now (now-ms)
        live-sessions (tmux-live-sessions)
        agents-running (count (remove #{operator-session} live-sessions))
        roles (operator-lib/parse-roles-tsv
               (when (fs/exists? roles-file) (slurp (str roles-file))))
        prov (scan-provider-state now)
        provider-state (:state prov)]

    ;; record / clear cooldown, emit provider events on edge transitions
    (let [was (read-cooldown)]
      (cond
        (and (= provider-state :cooldown) (:reset-ms prov))
        (when (or (nil? was) (not= (:reset_ms was) (:reset-ms prov)))
          (write-cooldown! {:reset_ms (:reset-ms prov) :reset_raw (:reset-raw prov)})
          (enqueue-observed! [{:type "PROVIDER_LIMIT_REACHED"
                               :detail (:reset-raw prov)}])
          (log! "provider" "cooldown until" (str (:reset-raw prov))))

        (and was (= provider-state :available))
        (do (clear-cooldown!)
            (enqueue-observed! [{:type "PROVIDER_AVAILABLE"}])
            (log! "provider" "available (cooldown cleared)"))))

    ;; observe events: dead agents, swarm-check timer, human command, new tasks
    (let [observed (cond-> (operator-lib/dead-agent-events roles live-sessions)
                     (operator-lib/timer-due? (last-swarm-check-ms) now swarm-check-ms)
                     (conj {:type "SWARM_CHECK_TIMER"})
                     (fs/exists? command-file)
                     (conj {:type "HUMAN_COMMAND"
                            :detail (str/trim (slurp (str command-file)))})
                     (coordinator-inbox-has-fresh?)
                     (conj {:type "TASK_ARRIVED"}))]
      (when (operator-lib/timer-due? (last-swarm-check-ms) now swarm-check-ms)
        (record-swarm-check! now))
      (enqueue-observed! observed))

    ;; BL-281 (reshaped): TELEGRAM_TOPIC_MESSAGE events now arrive here
    ;; because the bridge's inbound-message route appends them directly to
    ;; events-file - no poll, no direct Telegram call from the runtime.

    ;; BL-276: gentle idle nudge, posted directly (bypasses the event
    ;; queue/dispatch-batch entirely - a nudge is a best-effort side
    ;; message into an already-open topic, not a wake worth spending an
    ;; Operator LLM launch on).
    (idle-nudge-sweep! now)

    (reap-finished-operator!)

    (let [llm-running? (operator-running?)
          pending (read-events events-file)
          decision (operator-lib/should-launch-operator?
                    {:llm-running? llm-running?
                     :provider-state provider-state
                     :pending-count (count pending)})
          state (cond
                  (= provider-state :cooldown) :waiting_for_provider
                  llm-running? :operator_running
                  (pos? (count pending)) :dispatching
                  :else :idle)]
      (write-status! (operator-lib/render-status
                      {:state state :llm-running? llm-running?
                       :provider "claude" :provider-state provider-state
                       :agents-running agents-running
                       :pending-count (count pending)}))
      (when decision
        (log! "decision" "launch (pending=" (str (count pending)) ")")
        (launch-operator!)
        (fs/delete-if-exists command-file))
      {:state state :launched? decision :pending (count pending)
       :provider provider-state :agents agents-running})))

;; ── main ──────────────────────────────────────────────────────────────────────

(defn -main []
  (fs/create-dirs op-dir)
  (if tick-once?
    (println (json/generate-string (tick!)))
    (do
      (atomic-spit! pid-file (str (.pid (java.lang.ProcessHandle/current))))
      (log! "operator-runtime started"
            (str "interval-ms=" interval-ms " swarm-check-ms=" swarm-check-ms))
      (try
        (while (not (fs/exists? stop-file))
          (try (tick!) (catch Exception e (log! "tick-error" (.getMessage e))))
          (Thread/sleep interval-ms))
        (finally
          (fs/delete-if-exists pid-file)
          (log! "operator-runtime stopped"))))))

(-main)
