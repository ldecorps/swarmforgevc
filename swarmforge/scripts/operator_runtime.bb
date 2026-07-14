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
;; BL-283: reads a linked ticket's CURRENT backlog status for
;; linked-ticket-status-sweep! below.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "ticket_status_lib.bb")))
;; BL-307: the ONE shared mailbox-path resolver (handoff-protocol.md - no
;; script constructs a mailbox path by hand), for closing-pass-sweep!'s own
;; per-role inbox/in-process gathering below.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
;; BL-333: the starvation alarm reuses the SAME daemon-death email path
;; (build-alarm-email/send-configured-email!), never a second notifier -
;; the ticket's own explicit "REUSE IT; do not build a new notifier".
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_alarm_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: operator_runtime.bb <project-root> [--tick-once]"))
  (System/exit 1))

(def project-root (or (first *command-line-args*) (usage)))
(def tick-once? (some #{"--tick-once"} *command-line-args*))

;; BL-328: this long-lived process's own build identity, captured ONCE at
;; startup (a fresh bb invocation on every --tick-once call too, which is
;; correct for that mode - each call IS a fresh assessment). Babashka has
;; no separate compile step; the SOURCE loaded at THIS moment IS what runs
;; until the process exits, exactly like a Node process's own compiled
;; extension/out/BUILD_SHA - never re-read live, which would report
;; whatever main currently is rather than what this process actually
;; loaded. nil (never a crash) when git is unavailable.
(defn- capture-build-sha! []
  (try
    (let [{:keys [exit out]} (process/sh {:continue true :dir project-root} "git" "rev-parse" "HEAD")]
      (when (zero? exit) (str/trim out)))
    (catch Exception _ nil)))

(def own-build-sha (capture-build-sha!))

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
;; ── BL-334: the restricted front-desk Operator (own liveness/inflight
;;    state, own tmux socket - NEVER the unrestricted Operator's own
;;    operator-socket-file/operator-pid-file above) ────────────────────────
(def launch-front-desk-operator (fs/path script-dir "launch_front_desk_operator.sh"))
(def front-desk-inflight-file (fs/path op-dir "front-desk.events.inflight.jsonl"))
(def front-desk-pid-file (fs/path op-dir "front-desk-operator.pid"))
(def front-desk-socket-file (fs/path op-dir "front-desk-operator-tmux.sock"))
(def front-desk-prompt-file (fs/path op-dir "front-desk-prompt.txt"))
(def front-desk-result-file (fs/path op-dir "front-desk-result.json"))
;; The one piece of cross-tick state the async launch needs to remember: the
;; thread id it was dispatched for, so the LATER tick that reaps the result
;; knows which SUP-### thread to post the reply onto.
(def front-desk-dispatch-context-file (fs/path op-dir "front-desk-dispatch-context.json"))
(def front-desk-session "front-desk-operator")
;; BL-325: the SAME BL-285 approve relay bl-topic-approval-sweep! below
;; shells out to directly - never a second relay.
(def operator-decide-cli (fs/path project-root "extension" "out" "tools" "operator-decide.js"))
;; BL-307: the whole-swarm auto-hibernate closing pass. roles-backup-file
;; and hibernation-state-file are the same posture as cooldown.json/
;; awaiting-answer.json above - durable, runtime-owned cross-tick state.
(def roles-backup-file (fs/path state-dir "roles.tsv.hibernate-backup"))
(def hibernation-state-file (fs/path op-dir "hibernation.json"))
(def backlog-active-dir (fs/path project-root "backlog" "active"))
(def backlog-paused-dir (fs/path project-root "backlog" "paused"))
(def swarmforge-sh (fs/path script-dir "swarmforge.sh"))

;; Resilient remote-access tunnel (Microsoft `code tunnel`). The runtime keeps
;; a phone-reachable vscode.dev tunnel into this box alive so the swarm can be
;; observed and bounced even when the Remote Control relay / extension host are
;; dead — a channel that rides a different transport than RC, owned by the
;; always-alive runtime rather than a transient session. See operator_tunnel.sh.
(def tunnel-helper (fs/path script-dir "operator_tunnel.sh"))
(def tunnel-status-file (fs/path op-dir "tunnel.status.json"))

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

;; ── BL-306: ask + await a clarifying answer ────────────────────────────────
;; Runtime-owned cross-tick state, same posture as cooldown.json - the
;; disposable Operator LLM asks (one run, via operator_ask.bb) then MUST
;; exit; this file is what lets a LATER run know a question is still
;; pending, and what the runtime itself times out.
(def awaiting-answer-file (fs/path op-dir "awaiting-answer.json"))

;; ── BL-333: front-desk starvation - queue-backlog-started-at + alarm-armed,
;;    persisted cross-tick, same posture as cooldown.json above ────────────
(def starvation-state-file (fs/path op-dir "starvation.json"))

(defn env-ms [name default]
  (or (some-> (System/getenv name) parse-long) default))

(def interval-ms (env-ms "OPERATOR_INTERVAL_MS" 30000))
(def swarm-check-ms (env-ms "OPERATOR_SWARM_CHECK_MS" 1800000))
;; BL-305: fail-open cooldown config - see operator_lib.bb's own
;; resolve-provider-state docstring for what each bounds.
(def cooldown-bounded-fallback-ms (env-ms "OPERATOR_COOLDOWN_FALLBACK_MS" 1800000))
(def cooldown-plausible-max-ms (env-ms "OPERATOR_COOLDOWN_PLAUSIBLE_MAX_MS" 21600000))
;; BL-306: how long the runtime waits for a human reply to a pending
;; clarifying question before escalating once and dropping the wait.
(def await-timeout-ms (env-ms "OPERATOR_AWAIT_TIMEOUT_MS" 3600000))
;; BL-310: the closing pass's cold-start guard - never hibernate within this
;; many ms of the runtime's own process start (see runtime-started-at-ms).
(def launch-grace-ms (env-ms "OPERATOR_LAUNCH_GRACE_MS" 120000))
(def heartbeat? (not= "0" (System/getenv "OPERATOR_HEARTBEAT")))
(def skip-launch? (= "1" (System/getenv "OPERATOR_SKIP_LAUNCH")))
;; BL-333: starvation thresholds - EITHER trigger alone is starvation (a
;; short-but-old queue is missed by a count-only check, per the ticket's
;; own "3 events unread for two days is starvation just as much as 25
;; events unread for an hour"). Defaults sane, not hardcoded: the real
;; incident this ticket documents ran pending_events=22-25 for 45.8 hours.
(def starvation-count-limit (env-ms "OPERATOR_STARVATION_COUNT_LIMIT" 5))
(def starvation-age-limit-ms (env-ms "OPERATOR_STARVATION_AGE_MS" 3600000))
;; BL-345: bounded retry-with-backoff for an alarm delivery ATTEMPT that
;; fails transiently - the engineering article's mandatory bounded-retry
;; rule, same exponential-backoff-capped-at-max shape as front-desk-
;; supervisor-lib's own restart config. Defaults: 1m/2m/4m/8m/16m across 5
;; attempts (~31m worst case) before giving up and arming anyway.
(def alarm-max-attempts (env-ms "OPERATOR_ALARM_MAX_ATTEMPTS" 5))
(def alarm-backoff-base-ms (env-ms "OPERATOR_ALARM_BACKOFF_BASE_MS" 60000))
(def alarm-backoff-max-ms (env-ms "OPERATOR_ALARM_BACKOFF_MAX_MS" 1800000))
(def alarm-retry-config {:max-attempts alarm-max-attempts
                          :backoff-base-ms alarm-backoff-base-ms
                          :backoff-max-ms alarm-backoff-max-ms})

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

(defn tmux-control-status
  "Whether the swarm's tmux control channel actually responded just now, and
   the live session names if so. BL-368: this is the load-bearing
   distinction the incident exposed - 'tmux answered, here is its (possibly
   empty) session list' (:reachable? true) is a DIFFERENT fact about the
   world than 'a control channel that USED TO exist stopped responding'
   (:reachable? false).

   Only a PRESENT-but-now-failing socket pointer counts as lost control - you
   cannot lose control of something that was never established. No pointer
   file at all (tmux-socket returns nil: a swarm that has not launched tmux
   sessions yet, or a test fixture with no real tmux) is treated as the
   ordinary empty-sessions case, exactly as before this ticket - dead-agent-
   events still runs and correctly reports every expected-but-absent role.
   It is specifically the incident shape - the pointer file is intact and
   names a real path, but tmux itself errors talking to it (the underlying
   unix socket was unlinked out from under a running server, BL-367's own
   incident) - that produces control-lost-event instead of a misleading
   N x AGENT_EXITED batch."
  []
  (if-let [sock (tmux-socket)]
    (let [{:keys [out exit]} (process/sh {:continue true}
                                         "tmux" "-S" sock "list-windows" "-a"
                                         "-F" "#{session_name}")]
      (if (zero? exit)
        {:reachable? true
         :sessions (->> (str/split-lines out) (map str/trim) (remove str/blank?) distinct vec)}
        {:reachable? false :sessions []}))
    {:reachable? true :sessions []}))

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

(defn front-desk-operator-running?
  "Is the restricted front-desk Operator currently alive? Checks its OWN
   dedicated socket/pid file — NEVER operator-socket-file/operator-pid-file
   above, which track the UNRESTRICTED Operator. The two must never be
   conflated: this is the guard that lets should-launch-front-desk-operator?
   avoid double-launching a second front-desk run while one is still in
   flight, independent of whatever the unrestricted Operator is doing."
  []
  (boolean (or (some #{front-desk-session} (tmux-sessions-on front-desk-socket-file))
               (pid-alive? (read-pid front-desk-pid-file)))))

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

;; BL-369: events-file has TWO writers in TWO PROCESSES - the bridge (Node)
;; appends via extension/src/bridge/operatorEventQueue.ts, this process reads
;; then rewrites/deletes it on every tick. O_APPEND makes a bare append safe
;; against another append, but it protects NOTHING against a concurrent
;; whole-file rewrite: any event the bridge appends between one of the four
;; read-modify-write sites below's OWN read and its OWN commit is silently
;; destroyed the instant that commit lands (BL-369's root-cause incident).
;; Reuses the EXACT mkdir-as-mutex shape swarm_handoff.bb's next-sequence
;; already establishes for this codebase (mkdir is atomic on POSIX; a second
;; fs/create-dir on an existing dir throws FileAlreadyExistsException, caught
;; and treated as "held, retry") - a real filesystem operation, so the SAME
;; lock directory is honored identically whether acquired from this JVM
;; process or the bridge's Node process. Bounded (per the engineering
;; article's own "any retry loop must be bounded" rule) rather than an
;; infinite spin, so a genuinely stuck/orphaned lock surfaces loudly instead
;; of hanging every future tick forever.
(def events-lock-dir (fs/path op-dir "events.jsonl.lock"))
;; env-overridable (same seam convention as interval-ms/swarm-check-ms above,
;; and the engineering article's own "give the production timeout the same
;; env-override seam" rule) so a test can drive the timeout path in
;; milliseconds instead of the real 5s default - proving it fires without a
;; slow, real-clock-bound test.
(def events-lock-retry-delay-ms (env-ms "OPERATOR_EVENTS_LOCK_RETRY_DELAY_MS" 25))
(def events-lock-max-wait-ms (env-ms "OPERATOR_EVENTS_LOCK_MAX_WAIT_MS" 5000))

(defn- acquire-events-lock! []
  (fs/create-dirs op-dir)
  (let [deadline (+ (System/currentTimeMillis) events-lock-max-wait-ms)]
    (loop []
      (if (try
            (fs/create-dir events-lock-dir)
            true
            (catch java.nio.file.FileAlreadyExistsException _
              false))
        nil
        (if (>= (System/currentTimeMillis) deadline)
          (throw (ex-info (str "events lock timed out after " events-lock-max-wait-ms
                                "ms - a stale lock dir may need manual cleanup")
                           {:lock-dir (str events-lock-dir)}))
          (do (Thread/sleep events-lock-retry-delay-ms)
              (recur)))))))

(defn- release-events-lock! []
  (fs/delete events-lock-dir))

;; Test-only, defaults to 0 (no-op) in production: holds the lock an extra
;; fixed duration right after acquiring it, before running the critical
;; section - lets a test deterministically prove mutual exclusion against a
;; REAL concurrent writer (the actual compiled bridge process attempting a
;; real appendOperatorEvent while this hold is in effect) instead of relying
;; on a real-timer race with no controllable interleaving.
(def events-lock-test-hold-ms (env-ms "OPERATOR_EVENTS_LOCK_TEST_HOLD_MS" 0))

;; The critical section must stay SHORT (just the events.jsonl read+write) -
;; never wrap slow work (a subprocess launch, a network call) in this lock,
;; since the bridge's own appendOperatorEvent blocks on the SAME lock and a
;; long hold here would stall every inbound Telegram message for its
;; duration. Each call site below is scoped to exactly its read-modify-write,
;; nothing more.
(defn with-events-lock* [f]
  (acquire-events-lock!)
  (when (pos? events-lock-test-hold-ms)
    (Thread/sleep events-lock-test-hold-ms))
  (try (f) (finally (release-events-lock!))))

(defmacro with-events-lock [& body]
  `(with-events-lock* (fn [] ~@body)))

(defn enqueue-observed!
  "Append every observed event that survives operator-lib de-dup against what
   is already queued. Returns the number newly enqueued."
  [observed]
  (with-events-lock
    (let [pending (read-events events-file)
          merged (operator-lib/merge-events pending observed)
          added (drop (count pending) merged)]
      (doseq [e added] (append-event! e))
      (count added))))

;; BL-369 no-inbound-message-is-ever-lost-04: the safety net beneath the
;; bridge's own retry-on-failure ingest (bridgeServer.ts's own
;; ingestTelegramInboundMessage) - for whatever still slips through it (a
;; crash before any retry ever landed, a message hand-planted directly into
;; a transcript, etc). A thread message with an updateId (came from a real
;; Telegram update) but no eventQueued flag was recorded but never
;; confirmed queued - reclaims it by enqueueing the SAME TELEGRAM_TOPIC_
;; MESSAGE shape the bridge itself would have, then marks it queued.
;; Idempotent BY CONSTRUCTION: marking eventQueued true is the exact
;; condition that makes the NEXT sweep see nothing left to reclaim for that
;; message - the SAME flag the bridge's own ingest sets on success, never a
;; second, parallel notion of "handled".
(defn reconcile-unqueued-messages! []
  (doseq [thread-id (support-thread-store/list-existing-ids! state-dir)]
    (when-let [thread (support-thread-store/read-thread! state-dir thread-id)]
      (let [unqueued-ids (->> (:messages thread)
                               (filter #(and (:updateId %) (not (:eventQueued %))))
                               (map :updateId)
                               set)]
        (when (seq unqueued-ids)
          (doseq [update-id unqueued-ids]
            (with-events-lock
              (append-event! {:type "TELEGRAM_TOPIC_MESSAGE" :subject thread-id :updateId update-id})))
          (support-thread-store/write-thread!
           state-dir
           (update thread :messages
                   (fn [messages]
                     (mapv (fn [m] (if (contains? unqueued-ids (:updateId m)) (assoc m :eventQueued true) m)) messages))))
          (log! "reconcile-unqueued" thread-id (str "reclaimed=" (count unqueued-ids))))))))

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

;; ── BL-283: linked-ticket status-back sweep (coordinator-handoff-03/04/05) ─
;; Reuses support-lib/check-linked-ticket-status! (adapter-injected, itself
;; reusing proactive-notice-decision/proactive-notice-text UNCHANGED - no
;; second notice path) with REAL adapters: ticket-status-lib/current-status
;; for the live backlog read, and the SAME append-to-reply-outbox!/
;; support-thread-store write path idle-nudge-sweep! above already uses -
;; a status notice reaches its subject's topic the identical way any other
;; Operator reply does. Re-reads the thread fresh before each linked
;; ticket's own check (not once per thread-id) so a thread with more than
;; one linked ticket never has a second check overwrite the first's update.
(defn linked-ticket-status-sweep! []
  (doseq [thread-id (support-thread-store/list-existing-ids! state-dir)]
    (doseq [linked-id (map :id (:linked-tickets (support-thread-store/read-thread! state-dir thread-id)))]
      (let [thread (support-thread-store/read-thread! state-dir thread-id)
            linked (first (filter #(= (:id %) linked-id) (:linked-tickets thread)))
            current (ticket-status-lib/current-status project-root linked-id)]
        (when (:posted?
               (support-lib/check-linked-ticket-status!
                thread linked
                {:current-status! (fn [_id] current)
                 :now-iso! now-iso
                 :post-notice! (fn [tid text] (append-to-reply-outbox! tid text))
                 :write-thread! #(support-thread-store/write-thread! state-dir %)}))
          (log! "linked-ticket-status-posted" thread-id linked-id current))))))

;; ── cooldown / provider state ─────────────────────────────────────────────────

(defn read-cooldown []
  (when (fs/exists? cooldown-file)
    (try (json/parse-string (slurp (str cooldown-file)) true) (catch Exception _ nil))))

(defn write-cooldown! [m] (atomic-spit! cooldown-file (json/generate-string m)))
(defn clear-cooldown! [] (fs/delete-if-exists cooldown-file))

;; ── BL-333: front-desk starvation state (runtime-owned, same posture as
;;    cooldown above) - {:backlog-started-at-ms :armed?} ────────────────────

(defn read-starvation-state []
  (or (when (fs/exists? starvation-state-file)
        (try (json/parse-string (slurp (str starvation-state-file)) true) (catch Exception _ nil)))
      {}))

(defn write-starvation-state! [m] (atomic-spit! starvation-state-file (json/generate-string m)))

;; BL-215/BL-326's own pattern, mirrored exactly: warn ONCE per process on a
;; configured-but-keyless alarm, never touch the network from a throwaway
;; test-fixture root (test-fixture-root? inside send-configured-email!
;; itself already guards that; this is just the warn-once bookkeeping).
(def starvation-email-key-warned? (atom false))

;; BL-345 E2E test seam: when set, short-circuits the real send entirely and
;; returns this JSON-decoded result instead - lets the acceptance suite
;; drive the REAL tick!/caller logic (arming, retry counting, backoff,
;; give-up logging) against a scripted transient-failure/success sequence
;; without ever reaching daemon-alarm-lib or the network (mirrors this
;; file's own OPERATOR_SKIP_LAUNCH dry-run convention). Never set in
;; production; a bare env-var check, same posture as skip-launch? above.
(defn send-starvation-alarm-email! [subject text]
  (if-let [forced (System/getenv "OPERATOR_ALARM_FORCE_RESULT")]
    (json/parse-string forced true)
    (daemon-alarm-lib/send-configured-email!
     project-root conf-file subject text
     {:already-warned?! (fn [] @starvation-email-key-warned?)
      :log-warning! (fn [msg] (log! "email-misconfigured" msg))
      :mark-warned! (fn [] (reset! starvation-email-key-warned? true))})))

;; ── BL-306: awaiting-answer (runtime-owned, same posture as cooldown) ────────

(defn read-awaiting-answer []
  (when (fs/exists? awaiting-answer-file)
    (try
      (let [m (json/parse-string (slurp (str awaiting-answer-file)) true)]
        {:question (:question m) :thread-id (:thread_id m) :asked-at-ms (:asked_at_ms m)})
      (catch Exception _ nil))))

(defn write-awaiting-answer! [{:keys [question thread-id asked-at-ms]}]
  (atomic-spit! awaiting-answer-file
                (json/generate-string {:question question :thread_id thread-id :asked_at_ms asked-at-ms})))

(defn clear-awaiting-answer! [] (fs/delete-if-exists awaiting-answer-file))

;; BL-306: the bounded escalate-once-then-drop sweep - best-effort side
;; action, same "runs every tick, never a wake worth an Operator LLM
;; launch" posture as the idle-nudge/linked-ticket sweeps above.
(defn awaiting-answer-sweep! [now]
  (let [{:keys [event question thread-id]} (operator-lib/check-awaiting-answer (read-awaiting-answer) now await-timeout-ms)]
    (when (= event :escalate-and-drop)
      (let [text (str "[still needed] " question)]
        (append-to-reply-outbox! thread-id text)
        (when-let [thread (support-thread-store/read-thread! state-dir thread-id)]
          (support-thread-store/write-thread! state-dir (support-lib/append-message thread support-lib/operator-channel (now-iso) text))))
      (clear-awaiting-answer!)
      (log! "await-escalated-and-dropped" thread-id question))))

;; ── BL-325: deterministic BL-topic-message consumer ─────────────────────────
;; TELEGRAM_BL_TOPIC_MESSAGE (a human's reply typed into a backlog item's own
;; topic, BL-298's producer) had zero consumers - written, never read. This
;; sweep is that consumer: every tick, BEFORE the launch-decision below even
;; counts pending events, it pulls every such event out of the queue and
;; shells directly into operator-decide.js's OWN approve mode (BL-285) -
;; reusing that relay exactly, never a second one. threadId is the
;; backlogId itself; the reply-outbox->SSE relay's resolveReplyTopicId
;; fallback (BL-325's egress extension, telegramFrontDeskBotCore.ts) is what
;; lets that threadId route back into the SAME BL topic the question came
;; from. Deterministic and same-tick, never deferred to the disposable LLM
;; Operator's own reasoning latency - the ticket's own scenario-05 ordering
;; guarantee (the item must not complete before the human's answer arrives).
(defn consume-bl-topic-message! [{:keys [backlogId text]}]
  (let [{:keys [exit err]} (process/sh {:continue true :dir (str project-root)}
                                        "node" (str operator-decide-cli) backlogId "approve" text)]
    (when-not (zero? exit)
      (log! "bl-topic-consume-error" backlogId err))))

;; BL-369: the events-file rewrite happens FIRST, inside the lock, BEFORE the
;; (potentially slow - each consume shells to a node subprocess) consume
;; loop - `remaining` only ever depends on the READ snapshot, never on the
;; consume loop's own outcome, so claiming the rewrite up front and
;; processing after is behavior-preserving while keeping the locked critical
;; section to just the read+write (mirrors launch-operator!'s own
;; claim-then-process ordering below).
(defn bl-topic-approval-sweep! []
  (let [to-consume (with-events-lock
                      (let [pending (read-events events-file)
                            {:keys [to-consume remaining]} (operator-lib/partition-bl-topic-events pending)]
                        (when (seq to-consume)
                          (write-events! events-file (vec remaining)))
                        to-consume))]
    (doseq [event to-consume]
      (consume-bl-topic-message! event)
      (log! "bl-topic-consumed" (:backlogId event)))))

;; ── BL-307: auto-hibernate on drain + mandatory closing pass ────────────────
;; Reuses the exact hand-proven park/relaunch mechanics (see memory
;; swarm-profiles-full-forge-concierge-banked) - this is the thin, impure
;; wiring; the decision + orchestration logic itself lives in
;; operator_lib.bb's should-hibernate?/should-relaunch?/hibernate-swarm!/
;; relaunch-swarm!/evaluate-closing-pass!, all adapter-injected so they are
;; unit-testable without a real tmux socket.

(defn read-hibernation-state []
  (when (fs/exists? hibernation-state-file)
    (try (json/parse-string (slurp (str hibernation-state-file)) true) (catch Exception _ nil))))

(defn already-hibernated? []
  (boolean (:hibernated (read-hibernation-state))))

(defn- yaml-files [dir]
  (if (fs/exists? dir)
    (filter #(str/ends-with? (fs/file-name %) ".yaml") (fs/list-dir dir))
    []))

;; Duplicated from ticket_status_lib.bb's/chase_sweep_lib.bb's own private
;; read-yaml-field rather than cross-namespace-coupled to either - the same
;; small live-glue duplication already established across this codebase's
;; independent pure libs (see operator-lib's own operator-channel-name).
(defn- read-yaml-field [content field]
  (let [prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (str/trim (subs line (count prefix)))))
          (str/split-lines content))))

(defn active-backlog-count []
  (count (yaml-files backlog-active-dir)))

(defn paused-backlog-items []
  (vec (for [f (yaml-files backlog-paused-dir)]
         (let [content (slurp (str f))]
           {:status (read-yaml-field content "status")
            ;; BL-318: source is read here too - operator-lib/backlog-
            ;; drained? now excludes a self-generated paused item (source
            ;; carrying format-self-generated-source's own marker) from
            ;; counting as pending work, so it can no longer be the reason
            ;; hibernation never fires.
            :source (read-yaml-field content "source")}))))

;; Duplicated from handoffd_supervisor.bb's own count-handoff-files - same
;; small live-glue duplication rationale as read-yaml-field above.
(defn- count-handoff-files [dir]
  (if (fs/exists? dir)
    (count (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".handoff"))
                   (fs/list-dir dir)))
    0))

(defn- count-in-process-files
  "Direct .handoff files plus one level of batch_* subdirectory contents -
   a batch role (cleaner/hardener/architect) holds its in-process work inside
   one such subdirectory, mirrors chase_sweep_lib.bb's own collect-in-process."
  [dir]
  (if-not (fs/exists? dir)
    0
    (reduce + (for [entry (fs/list-dir dir)
                    :let [name (fs/file-name entry)]]
                (cond
                  (and (fs/directory? entry) (str/starts-with? name "batch_")) (count-handoff-files entry)
                  (and (fs/regular-file? entry) (str/ends-with? name ".handoff")) 1
                  :else 0)))))

(defn roster-role-states
  "Every CURRENT roster role (read fresh from roles.tsv via handoff-lib's own
   shared mailbox resolver, never a hardcoded role list) paired with its
   pending-inbox/in-process counts. A role absent from roles.tsv simply never
   appears here."
  []
  (vec (for [role-info (handoff-lib/load-all-roles project-root)
             :when (:worktree-path role-info)]
         {:role (:role role-info)
          :inbox-new-count (count-handoff-files (handoff-lib/mailbox-dir role-info :new))
          :in-process-count (count-in-process-files (handoff-lib/mailbox-dir role-info :in_process))})))

(defn- backup-roster! []
  (when (fs/exists? roles-file)
    (fs/copy roles-file roles-backup-file {:replace-existing true})))

(defn- empty-roster! [] (atomic-spit! roles-file ""))

(defn- restore-roster! []
  (when (fs/exists? roles-backup-file)
    (fs/copy roles-backup-file roles-file {:replace-existing true})))

(defn- kill-swarm-tmux!
  "Kills the build-agent tmux sessions on the SWARM socket only - NEVER the
   Operator's own socket (operator-socket-file, a distinct file). A no-op
   when the swarm socket is already gone/absent, same posture as
   tmux-control-status above."
  []
  (when-let [sock (tmux-socket)]
    (process/sh {:continue true} "tmux" "-S" sock "kill-server")))

(defn- write-hibernation-state! [now-ms]
  (atomic-spit! hibernation-state-file
                (json/generate-string
                 {:hibernated true :hibernated_at_ms now-ms
                  :config_path (or (System/getenv "SWARMFORGE_CONFIG") "")})))

(defn- clear-hibernation-state! [] (fs/delete-if-exists hibernation-state-file))

(defn- relaunch-tmux!
  "Brings the build-agent tmux sessions back up via the SAME mechanism
   already proven by hand (SWARMFORGE_CONFIG override + the zsh entrypoint -
   never the self-updating ./swarm bootstrapper, never --pack; see memory
   swarm-profiles-full-forge-concierge-banked). Gated by skip-launch? the
   SAME dry-run flag launch-operator! already respects, so tests never spawn
   a real swarm relaunch."
  []
  (let [config (or (:config_path (read-hibernation-state)) "")]
    (if skip-launch?
      (log! "relaunch-swarm" "SKIPPED (OPERATOR_SKIP_LAUNCH=1)")
      (process/process ["zsh" (str swarmforge-sh) project-root]
                        {:out :inherit :err :inherit
                         :extra-env {"SWARMFORGE_CONFIG" config "SWARMFORGE_TERMINAL" "none"}}))))

(defn closing-pass-adapters []
  {:backup-roster! backup-roster!
   :empty-roster! empty-roster!
   :kill-swarm-tmux! kill-swarm-tmux!
   :write-hibernation-state! write-hibernation-state!
   :restore-roster! restore-roster!
   :relaunch-tmux! relaunch-tmux!
   :clear-hibernation-state! clear-hibernation-state!})

;; runtime-started-at-ms/coordinator-inbox-has-fresh? are defined further
;; down (they share the file-age-ms filesystem-signal section); declared
;; here so closing-pass-sweep! can reuse both without duplicating either.
(declare runtime-started-at-ms coordinator-inbox-has-fresh?)

(defn closing-pass-sweep!
  "One tick's full BL-307/BL-310 evaluation: gathers the pure state
   (backlog-drained?, roster-idle?, already-hibernated?, within-launch-
   grace?, fresh-coordinator-mail?) and hands it to operator-lib/
   evaluate-closing-pass! with the real adapters above. Logs+returns the
   action taken (:hibernated/:relaunched/nil).

   Guarded by eligible?: a roster that has NEVER existed (roles.tsv absent/
   empty, e.g. a fresh checkout or a runtime started standalone before any
   swarm launch) is vacuously 'idle' too, but hibernating one is meaningless
   - nothing to back up, nothing to kill - so the DOWN-trigger only fires
   once a real roster is actually on record. The UP-trigger is exempt (an
   already-hibernated swarm legitimately HAS an emptied roles.tsv, and must
   still be able to relaunch)."
  [now]
  (let [roster (roster-role-states)
        drained? (operator-lib/backlog-drained? (active-backlog-count) (paused-backlog-items))
        idle? (operator-lib/roster-idle? roster)
        hibernated-before? (already-hibernated?)
        eligible? (or hibernated-before? (seq roster))
        within-grace? (operator-lib/within-launch-grace? (runtime-started-at-ms) now launch-grace-ms)
        fresh-mail? (boolean (coordinator-inbox-has-fresh?))
        {:keys [action] :as result} (if eligible?
                                       (operator-lib/evaluate-closing-pass!
                                        {:backlog-drained? drained? :roster-idle? idle?
                                         :already-hibernated? hibernated-before? :now-ms now
                                         :within-launch-grace? within-grace?
                                         :fresh-coordinator-mail? fresh-mail?}
                                        (closing-pass-adapters))
                                       {:action nil})]
    (when action (log! "closing-pass" (name action)))
    result))

(defn scan-provider-state
  "Look at the agent panes + the operator's own last run for a usage-limit
   banner. Returns {:state :available|:cooldown, :reset-ms N?, :reset-raw s?}.
   A THIN caller (BL-305): gathers the live pane text + the persisted
   cooldown record, then hands the whole fail-open DECISION to
   operator_lib.bb's own resolve-provider-state - this function performs
   no cooldown/freeze policy itself."
  [now]
  (let [existing (read-cooldown)
        agent-panes (->> (operator-lib/parse-roles-tsv
                          (when (fs/exists? roles-file) (slurp (str roles-file))))
                         (map :session) distinct
                         (keep #(capture-pane % 40)))
        ;; the Operator's own pane lives on its dedicated socket, not the swarm's
        op-pane (capture-pane-on operator-socket-file operator-session 40)
        panes (keep identity (cons op-pane agent-panes))
        limited-text (some #(when (operator-lib/usage-limited? %) %) panes)
        clock (when limited-text (operator-lib/parse-reset-clock limited-text))
        parsed-reset-ms (when clock (operator-lib/reset-epoch-ms clock now (local-offset-ms)))
        reset-raw (when limited-text (some-> (re-find #"(?i)resets?[^\n]*" limited-text) str/trim))]
    (operator-lib/resolve-provider-state
     {:limited-text limited-text
      :parsed-reset-ms parsed-reset-ms
      :reset-raw reset-raw
      :existing-reset-ms (:reset_ms existing)
      :existing-reset-raw (:reset_raw existing)
      :now-ms now
      :bounded-fallback-ms cooldown-bounded-fallback-ms
      :plausible-max-ms cooldown-plausible-max-ms})))

;; ── timer ─────────────────────────────────────────────────────────────────────

(defn last-swarm-check-ms []
  (read-pid last-check-file)) ; reuse: file just holds an epoch-ms integer

(defn record-swarm-check! [ms] (atomic-spit! last-check-file (str ms)))

;; ── filesystem signals ────────────────────────────────────────────────────────

(defn file-age-ms [path]
  (when (fs/exists? path)
    (- (now-ms) (.toMillis (fs/last-modified-time path)))))

(defn runtime-started-at-ms
  "BL-310: the runtime's own process-start instant, reused from the
   existing pid-file write in -main rather than a new timestamp file - its
   mtime IS 'when this run of the tick loop began'. nil when the pid-file
   is absent (e.g. a --tick-once invocation never writes it)."
  []
  (when (fs/exists? pid-file)
    (.toMillis (fs/last-modified-time pid-file))))

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
   reply reaches it over SSE.

   BL-306 operator-ask-02 / BL-354 Option C: when this dispatched subject
   is the SAME thread a clarifying question is pending on
   (operator-lib/resolve-inbound-answer), the reply IS that question's
   answer - paired in as :pending-question/:answer, and the runtime's own
   await state is cleared (this reply has been delivered; nothing left to
   time out). When a question IS pending but in a DIFFERENT thread, the
   message is never consumed as the answer: :pending-question is still
   attached (so the Operator knows a question of its own is outstanding)
   but WITHOUT :answer, the question is re-posted into this thread over
   the same reply-outbox egress the escalation sweep already uses, and the
   await re-homes here - same question, same asked-at-ms (the deadline
   runs from the ORIGINAL ask, never reset by a thread hop), new
   thread-id. The next reply in THIS thread then pairs."
  [thread-id]
  (let [awaiting (read-awaiting-answer)
        decision (operator-lib/resolve-inbound-answer awaiting thread-id)
        transcript (telegram-topic-lib/reply-context-for thread-id (support-thread-store/adapters-for state-dir))]
    (case (:outcome decision)
      :pair (clear-awaiting-answer!)
      :re-home
      (let [question (:question decision)]
        (append-to-reply-outbox! thread-id question)
        (when-let [thread (support-thread-store/read-thread! state-dir thread-id)]
          (support-thread-store/write-thread! state-dir (support-lib/append-message thread support-lib/operator-channel (now-iso) question)))
        (write-awaiting-answer! {:question question :thread-id thread-id :asked-at-ms (:asked-at-ms decision)})
        (log! "await-re-homed" thread-id))
      :none nil)
    (atomic-spit! telegram-reply-context-file
                  (json/generate-string
                   (cond-> {:thread-id thread-id
                            :transcript transcript
                            :long-term-memory (operator-memory-lib/facts-for-wake (operator-memory-store/read-store! state-dir))}
                     (= (:outcome decision) :pair)
                     (assoc :pending-question (:question awaiting)
                            :answer (operator-lib/answer-text-from-messages (:messages transcript)))
                     (= (:outcome decision) :re-home)
                     (assoc :pending-question (:question decision)))))))

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
  (with-events-lock
    (let [pending (read-events events-file)
          {:keys [dispatch deferred]} (telegram-topic-lib/select-dispatch-batch pending)
          telegram-subject (dispatch-subject-of dispatch)]
      (fs/delete-if-exists events-file)
      (write-events! inflight-file dispatch)
      (doseq [e deferred] (append-event! e))
      (if telegram-subject
        (write-telegram-reply-context! telegram-subject)
        (fs/delete-if-exists telegram-reply-context-file))))
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

(defn archive-inflight-batch!
  "Move a retired inflight batch file into its own timestamped `-done`
   subdirectory under op-dir, so a crash never loses the queue permanently
   and each archived batch gets a unique name. Shared by the unrestricted
   Operator's and the front-desk Operator's own reap steps — the archival
   shape (create dir, move with a fresh events-<now-ms>.jsonl name) is
   identical for both; only which inflight file and which dir differ."
  [inflight-file done-dir-name]
  (let [done-dir (fs/path op-dir done-dir-name)]
    (fs/create-dirs done-dir)
    (fs/move inflight-file
             (fs/path done-dir (str "events-" (now-ms) ".jsonl"))
             {:replace-existing true})))

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
    (archive-inflight-batch! inflight-file "events-done")
    (fs/delete-if-exists operator-pid-file)
    ;; BL-281: a stale reply-context file must never carry over into the
    ;; NEXT (possibly non-Telegram) run.
    (fs/delete-if-exists telegram-reply-context-file)
    (log! "reap-operator" "inflight retired")))

;; ── BL-334: the restricted front-desk Operator (launch/reap) ─────────────

(defn launch-front-desk-operator!
  "Claims AT MOST ONE Telegram subject's worth of front-desk events (never
   any other event type — the front-desk Operator has no authority over
   those, see select-front-desk-dispatch-batch), writes them to its OWN
   inflight file (never events.inflight.jsonl, which belongs to the
   unrestricted Operator), records which thread it was dispatched for (so
   the LATER reap step knows where to post the reply), builds the FULL
   self-contained prompt (it holds no Read tool to fall back on), and spawns
   the headless, --tools \"\"-restricted claude call on its own tmux socket.
   Never launches a second one (caller already checked
   front-desk-operator-running?)."
  []
  (let [{:keys [dispatch]} (with-events-lock
                             (let [pending (read-events events-file)
                                   partitioned (telegram-topic-lib/select-front-desk-dispatch-batch pending)]
                               (write-events! events-file (vec (:remaining partitioned)))
                               partitioned))
        thread-id (first (keep :subject dispatch))]
    (when thread-id
      (write-events! front-desk-inflight-file dispatch)
      (atomic-spit! front-desk-dispatch-context-file (json/generate-string {:thread-id thread-id}))
      (let [transcript (telegram-topic-lib/reply-context-for thread-id (support-thread-store/adapters-for state-dir))
            memory (operator-memory-lib/facts-for-wake (operator-memory-store/read-store! state-dir))
            prompt (operator-lib/front-desk-reply-prompt {:transcript transcript :long-term-memory memory})]
        (atomic-spit! front-desk-prompt-file prompt))
      (log! "launch-front-desk-operator" "thread=" thread-id)
      (if skip-launch?
        (log! "launch-front-desk-operator" "SKIPPED (OPERATOR_SKIP_LAUNCH=1)")
        (process/process ["bash" (str launch-front-desk-operator) project-root
                           (str front-desk-prompt-file) (str front-desk-result-file)]
                          {:out :inherit :err :inherit})))))

(defn reap-finished-front-desk-operator!
  "Retire a completed front-desk run. Its tmux session/process ends ON ITS
   OWN once the one-shot `claude -p` call exits (see
   launch_front_desk_operator.sh) — there is no done-marker or window-kill
   step, unlike the unrestricted Operator's long-lived RC session. Once it
   is no longer running: read the captured --output-format json result,
   post the reply text (if any) to the SAME reply-outbox/thread-transcript
   path any other Operator reply already uses (never a second delivery
   path — the SAME reuse discipline as BL-276's idle-nudge-sweep!), then
   archive the inflight batch and clear the run's cross-tick state."
  []
  (when (and (fs/exists? front-desk-inflight-file) (not (front-desk-operator-running?)))
    (let [context (when (fs/exists? front-desk-dispatch-context-file)
                    (try (json/parse-string (slurp (str front-desk-dispatch-context-file)) true)
                         (catch Exception _ nil)))
          thread-id (:thread-id context)
          result (when (fs/exists? front-desk-result-file)
                   (try (json/parse-string (slurp (str front-desk-result-file)) true)
                        (catch Exception _ nil)))
          reply (operator-lib/front-desk-reply-text result)]
      (if (and thread-id reply)
        (do (append-to-reply-outbox! thread-id reply)
            (when-let [thread (support-thread-store/read-thread! state-dir thread-id)]
              (support-thread-store/write-thread!
               state-dir
               (support-lib/append-message thread support-lib/operator-channel (now-iso) reply)))
            (log! "front-desk-replied" thread-id))
        (when thread-id (log! "front-desk-no-reply" thread-id)))
      (archive-inflight-batch! front-desk-inflight-file "front-desk-events-done")
      (fs/delete-if-exists front-desk-pid-file)
      (fs/delete-if-exists front-desk-dispatch-context-file)
      (fs/delete-if-exists front-desk-result-file)
      (fs/delete-if-exists (str front-desk-result-file ".err"))
      (fs/delete-if-exists front-desk-prompt-file))))

;; ── BL-345: delivery-based starvation-alarm sweep ───────────────────────────

(defn- alarm-email-text [pending-count oldest-pending-age-ms]
  (str "The front desk's inbound queue is not being drained: " pending-count
       " event(s) pending"
       (when oldest-pending-age-ms
         (str ", oldest waiting " (quot oldest-pending-age-ms 60000) " minute(s)"))
       ".\n\n"
       "An Operator is holding the single-Operator slot - an attended "
       "(interactive) session holds it indefinitely by design, so no "
       "disposable Operator can be spawned to read the queue while it "
       "does. The attended session is NOT being stopped - its longevity "
       "is a feature, not the bug.\n\n"
       "This clears on its own once the attended session ends; investigate "
       "sooner if the waiting messages are time-sensitive."))

(defn starvation-alarm-sweep!
  "One tick's full BL-345 delivery-based alarm evaluation. Returns the NEXT
   starvation state to persist via write-starvation-state!. Never attempts a
   send when not due (healthy, already armed, or backing off between
   retries) - starvation-alarm-should-attempt? is the ONLY gate. On an
   attempt, classifies send-starvation-alarm-email!'s own returned result
   (never discards it - that discard is exactly BL-345's bug) and logs
   ONE line naming the outcome, folding in the misconfiguration reason or
   a loud give-up marker so the acceptance suite (and a human grepping
   runtime.log) can tell what happened without a second log call."
  [{:keys [starving? prev-starvation backlog-started-at-ms pending-count oldest-pending-age-ms now]}]
  (if-not starving?
    ;; cleared (or never started): ready to arm fresh next time it starves.
    {:backlog-started-at-ms backlog-started-at-ms :armed? false
     :delivery-attempts 0 :last-attempt-at-ms nil}
    (let [armed? (boolean (:armed? prev-starvation))
          delivery-attempts (:delivery-attempts prev-starvation)
          last-attempt-at-ms (:last-attempt-at-ms prev-starvation)
          attempt? (operator-lib/starvation-alarm-should-attempt?
                    {:starving? starving? :armed? armed?
                     :delivery-attempts delivery-attempts
                     :last-attempt-at-ms last-attempt-at-ms
                     :now-ms now :retry-config alarm-retry-config})]
      (if-not attempt?
        (assoc prev-starvation :backlog-started-at-ms backlog-started-at-ms)
        (let [result (send-starvation-alarm-email!
                      "SwarmForge: front desk starved - Operator holding the slot, queue not draining"
                      (alarm-email-text pending-count oldest-pending-age-ms))
              outcome (operator-lib/classify-delivery-result result)
              {:keys [armed? delivery-attempts last-attempt-at-ms gave-up?]}
              (operator-lib/next-starvation-alarm-state outcome prev-starvation alarm-retry-config now)]
          (apply log! "starvation-alarm" (name outcome)
                 (remove nil?
                         [(str "pending=" pending-count)
                          (str "oldest-age-ms=" oldest-pending-age-ms)
                          (when (= outcome :terminal-misconfig)
                            (str "reason=" (name (or (:reason result) :unknown))))
                          (when gave-up? "GAVE-UP-after-max-attempts")]))
          {:backlog-started-at-ms backlog-started-at-ms :armed? armed?
           :delivery-attempts delivery-attempts :last-attempt-at-ms last-attempt-at-ms})))))

;; ── status ────────────────────────────────────────────────────────────────────

(defn write-status! [m]
  (atomic-spit! status-file (str (json/generate-string (assoc m :updated_at (now-iso))) "\n")))

;; ── remote-access tunnel ──────────────────────────────────────────────────────

(defn ensure-tunnel!
  "Best-effort: ask the tunnel helper to (re)establish the vscode.dev tunnel if
   it has died and we are authenticated. Idempotent and cheap — a no-op when the
   tunnel is already up, when auth has not been bootstrapped, or when disabled
   via SWARMFORGE_SKIP_TUNNEL. Never throws into the tick: the tunnel is a
   recovery convenience, not a runtime dependency."
  []
  (try
    (process/sh {:continue true} "bash" (str tunnel-helper) "ensure" project-root)
    (catch Exception e (log! "tunnel-error" (.getMessage e)))))

(defn read-tunnel-status
  "The tunnel helper's last-published status ({:state :url :name :updated_at}),
   or nil if it has never run. Surfaced into status.json so the phone can read
   the current tunnel URL from the same place as everything else."
  []
  (when (fs/exists? tunnel-status-file)
    (try (json/parse-string (slurp (str tunnel-status-file)) true)
         (catch Exception _ nil))))

;; ── one tick ──────────────────────────────────────────────────────────────────

(defn tick! []
  (when heartbeat? (atomic-spit! heartbeat-file (now-iso)))
  (let [now (now-ms)
        control (tmux-control-status)
        live-sessions (:sessions control)
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
    ;; BL-368: dead-agent-events is only ever computed from a CONFIRMED-
    ;; reachable session list - an unreachable control channel produces the
    ;; single control-lost-event instead, never N x AGENT_EXITED derived
    ;; from whatever empty/stale session list an unreachable tmux left
    ;; behind. These are different facts about the world and must never be
    ;; inferred from one another.
    (when-not (:reachable? control)
      ;; BL-368 (scenario 04): logged UNCONDITIONALLY, independent of the
      ;; disposable LLM Operator ever launching or noticing - "surfaced
      ;; loudly" must not be load-bearing on an LLM's judgment, same as the
      ;; misdiagnosis/relaunch guards above. runtime.log is the swarm's own
      ;; durable, human-checkable audit trail (log! above).
      (log! "SWARM_CONTROL_LOST" "tmux control channel unreachable - NOT agent death, human attention needed"))
    (let [observed (cond-> (if (:reachable? control)
                              (operator-lib/dead-agent-events roles live-sessions)
                              [(operator-lib/control-lost-event)])
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

    ;; BL-283: linked-ticket status-back, same "best-effort side message,
    ;; never a wake worth an Operator LLM launch" posture as the idle
    ;; nudge above.
    (linked-ticket-status-sweep!)

    ;; BL-306: bounded escalate-once-then-drop on an unanswered clarifying
    ;; question - same "best-effort side action every tick" posture as the
    ;; sweeps above; never gates the launch decision below (a pending
    ;; question is scoped to its own thread, never an emergency-recovery
    ;; blocker).
    (awaiting-answer-sweep! now)

    ;; BL-325: consume any TELEGRAM_BL_TOPIC_MESSAGE events (a human's reply
    ;; typed into a backlog item's own topic) deterministically, same tick -
    ;; before the pending count below is even read, so a consumed event
    ;; never also counts toward the LLM-launch decision.
    (bl-topic-approval-sweep!)

    ;; BL-369 no-inbound-message-is-ever-lost-04: reclaim any thread message
    ;; that was durably recorded but never confirmed queued - BEFORE the
    ;; pending count below is read, so a message this sweep just reclaimed
    ;; counts toward THIS tick's launch decision rather than waiting a
    ;; whole extra interval-ms for the next one.
    (reconcile-unqueued-messages!)

    ;; BL-307: auto-hibernate on drain + mandatory closing pass - same
    ;; "best-effort side action every tick" posture as the sweeps above;
    ;; never gates the LLM launch decision below (a hibernated swarm still
    ;; dispatches a genuine event exactly as it does today - only the
    ;; build-agent tmux sessions are parked, never handoffd/the runtime
    ;; itself/the front-desk bot).
    (closing-pass-sweep! now)

    (reap-finished-operator!)
    (reap-finished-front-desk-operator!)

    ;; keep the resilient remote-access tunnel alive (best-effort, non-blocking)
    (ensure-tunnel!)

    (let [llm-running? (operator-running?)
          pending (read-events events-file)
          pending-count (count pending)
          tunnel (read-tunnel-status)
          decision (operator-lib/should-launch-operator?
                    {:llm-running? llm-running?
                     :provider-state provider-state
                     :pending-count pending-count})
          ;; BL-334: the SAME llm-running? read above is passed as
          ;; :full-operator-running? here — the structural guarantee that the
          ;; two launch decisions are mutually exclusive within one tick (see
          ;; should-launch-front-desk-operator?'s own docstring).
          front-desk-running? (front-desk-operator-running?)
          front-desk-pending-count (count (filter #(= (:type %) "TELEGRAM_TOPIC_MESSAGE") pending))
          front-desk-decision (operator-lib/should-launch-front-desk-operator?
                               {:full-operator-running? llm-running?
                                :front-desk-running? front-desk-running?
                                :provider-state provider-state
                                :pending-count front-desk-pending-count})
          state (cond
                  (= provider-state :cooldown) :waiting_for_provider
                  llm-running? :operator_running
                  (pos? pending-count) :dispatching
                  (already-hibernated?) :hibernated
                  :else :idle)
          ;; BL-333: starvation detection - tracked every tick regardless of
          ;; `state` above (a live Operator reads as "healthy" state-wise;
          ;; starvation is an orthogonal fact overlaid on top of it, never a
          ;; replacement for the existing state machine).
          prev-starvation (read-starvation-state)
          backlog-started-at-ms (operator-lib/queue-backlog-started-at-ms
                                  (:backlog-started-at-ms prev-starvation) pending-count now)
          oldest-pending-age-ms (when backlog-started-at-ms (- now backlog-started-at-ms))
          starving? (operator-lib/front-desk-starving?
                     {:pending-count pending-count
                      :oldest-pending-age-ms oldest-pending-age-ms
                      :count-limit starvation-count-limit
                      :age-limit-ms starvation-age-limit-ms})]
      (write-starvation-state!
       (starvation-alarm-sweep! {:starving? starving? :prev-starvation prev-starvation
                                  :backlog-started-at-ms backlog-started-at-ms
                                  :pending-count pending-count
                                  :oldest-pending-age-ms oldest-pending-age-ms
                                  :now now}))
      ;; BL-334 restricted-front-desk-operator-07: the front-desk Operator's
      ;; status is nested under :front_desk in this SAME single write —
      ;; never a second write-status! call — which is what makes "neither
      ;; Operator's state has overwritten the other's" a property of the
      ;; wiring rather than something either status shape has to encode.
      (write-status! (cond-> (operator-lib/render-status
                              {:state state :llm-running? llm-running?
                               :provider "claude" :provider-state provider-state
                               :agents-running agents-running
                               :pending-count pending-count
                               :oldest-pending-age-ms oldest-pending-age-ms})
                       tunnel (assoc :tunnel tunnel)
                       true (assoc :build_sha own-build-sha)
                       true (assoc :front_desk
                                   (operator-lib/render-front-desk-status
                                    {:llm-running? front-desk-running?
                                     :pending-count front-desk-pending-count}))))
      (when decision
        (log! "decision" "launch (pending=" (str pending-count) ")")
        (launch-operator!)
        (fs/delete-if-exists command-file))
      (when front-desk-decision
        (log! "decision" "launch-front-desk (pending=" (str front-desk-pending-count) ")")
        (launch-front-desk-operator!))
      {:state state :launched? decision :pending pending-count
       :provider provider-state :agents agents-running :starving? starving?
       :front_desk_launched? front-desk-decision})))

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
