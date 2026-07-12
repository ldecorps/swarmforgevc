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

(defn bl-topic-approval-sweep! []
  (let [pending (read-events events-file)
        {:keys [to-consume remaining]} (operator-lib/partition-bl-topic-events pending)]
    (when (seq to-consume)
      (doseq [event to-consume]
        (consume-bl-topic-message! event)
        (log! "bl-topic-consumed" (:backlogId event)))
      (write-events! events-file (vec remaining)))))

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
   tmux-live-sessions above."
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

   BL-306 operator-ask-02: when this dispatched subject is the SAME thread
   a clarifying question is pending on (operator-lib/resolve-pending-
   answer), the reply IS that question's answer - paired in as
   :pending-question/:answer, and the runtime's own await state is cleared
   (this reply has been delivered; nothing left to time out)."
  [thread-id]
  (let [awaiting (read-awaiting-answer)
        pending? (operator-lib/resolve-pending-answer awaiting thread-id)
        transcript (telegram-topic-lib/reply-context-for thread-id (support-thread-store/adapters-for state-dir))]
    (when pending? (clear-awaiting-answer!))
    (atomic-spit! telegram-reply-context-file
                  (json/generate-string
                   (cond-> {:thread-id thread-id
                            :transcript transcript
                            :long-term-memory (operator-memory-lib/facts-for-wake (operator-memory-store/read-store! state-dir))}
                     pending? (assoc :pending-question (:question awaiting)
                                      :answer (operator-lib/answer-text-from-messages (:messages transcript))))))))

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

    ;; BL-307: auto-hibernate on drain + mandatory closing pass - same
    ;; "best-effort side action every tick" posture as the sweeps above;
    ;; never gates the LLM launch decision below (a hibernated swarm still
    ;; dispatches a genuine event exactly as it does today - only the
    ;; build-agent tmux sessions are parked, never handoffd/the runtime
    ;; itself/the front-desk bot).
    (closing-pass-sweep! now)

    (reap-finished-operator!)

    ;; keep the resilient remote-access tunnel alive (best-effort, non-blocking)
    (ensure-tunnel!)

    (let [llm-running? (operator-running?)
          pending (read-events events-file)
          tunnel (read-tunnel-status)
          decision (operator-lib/should-launch-operator?
                    {:llm-running? llm-running?
                     :provider-state provider-state
                     :pending-count (count pending)})
          state (cond
                  (= provider-state :cooldown) :waiting_for_provider
                  llm-running? :operator_running
                  (pos? (count pending)) :dispatching
                  (already-hibernated?) :hibernated
                  :else :idle)]
      (write-status! (cond-> (operator-lib/render-status
                              {:state state :llm-running? llm-running?
                               :provider "claude" :provider-state provider-state
                               :agents-running agents-running
                               :pending-count (count pending)})
                       tunnel (assoc :tunnel tunnel)))
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
