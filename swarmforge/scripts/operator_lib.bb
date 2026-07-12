#!/usr/bin/env bb

;; Operator v2 — pure decision logic for the lightweight Operator runtime
;; (operator_runtime.bb). Kept entirely side-effect-free so every branch is
;; unit-testable with no filesystem, tmux, or clock, exactly the way
;; handoffd_supervisor.bb isolates evaluate-health.
;;
;; The "Operator" is the EXTERNAL supervisor (a host-level Claude session,
;; like a Claude Desktop on the WSL2 box) that watches the swarm from
;; outside and reaches in through its tools. Operator v2 splits that role in
;; two: an always-alive lightweight RUNTIME (this repo's operator_runtime.bb)
;; that owns timers/heartbeat/status/event-detection and is cheap, and a
;; DISPOSABLE LLM Operator (Claude Opus) the runtime launches only when an
;; event actually needs reasoning, and which exits when done. Idle time then
;; costs ~zero LLM tokens.
;;
;; This file is the brain-stem: given observations (already gathered by the
;; runtime), it decides what events exist, whether the provider is in
;; cooldown, and whether to spend money launching the LLM. It never performs
;; I/O itself.

(ns operator-lib
  (:require [clojure.string :as str]))

;; ── event model ──────────────────────────────────────────────────────────────

(def event-types
  "The closed set of events the runtime can enqueue. The LLM Operator
   consumes them; the runtime only produces them."
  #{"AGENT_EXITED"        ; a role's tmux session/pane vanished
    "AGENT_STALLED"       ; a role idle with work it should be doing
    "SWARM_CHECK_TIMER"   ; the periodic health/progress sweep fell due
    "HUMAN_COMMAND"       ; the operator's human dropped a command file
    "PROVIDER_AVAILABLE"  ; a usage-limit cooldown elapsed
    "PROVIDER_LIMIT_REACHED"
    "CONFIG_CHANGED"      ; swarmforge.conf or a launch script changed
    "TASK_ARRIVED"        ; a new handoff/backlog item landed
    "TELEGRAM_TOPIC_MESSAGE"}) ; BL-281: an inbound Telegram forum-topic
                               ; message was demuxed to a SUP-### thread -
                               ; per-subject (:subject = the thread id,
                               ; like AGENT_EXITED/HUMAN_COMMAND/TASK_ARRIVED
                               ; below), never coalescing: a second message
                               ; on an ALREADY-pending thread still collapses
                               ; to one wake (event-key dedup), but a
                               ; DIFFERENT thread's message must survive as
                               ; its own distinct pending event.

(def coalescing-types
  "Event types where a second pending copy adds nothing — the LLM will
   re-observe full state anyway, so stacking duplicates just wastes a launch.
   AGENT_EXITED / HUMAN_COMMAND / TASK_ARRIVED are per-subject and are keyed
   separately (see event-key)."
  #{"SWARM_CHECK_TIMER" "PROVIDER_AVAILABLE" "PROVIDER_LIMIT_REACHED" "CONFIG_CHANGED"})

(defn event-key
  "Identity used for de-duplication. Coalescing types collapse to their type
   alone; subject-bearing types (AGENT_EXITED coder) stay distinct per
   subject so two different dead agents both survive."
  [{:keys [type subject]}]
  (if (contains? coalescing-types type)
    type
    (str type " " (or subject ""))))

(defn valid-event? [{:keys [type]}]
  (contains? event-types type))

(defn should-enqueue?
  "True when new-event is worth appending given the events already pending.
   Rejects unknown types and exact-key duplicates so the queue never grows
   without bound from a condition the runtime re-observes every tick."
  [pending new-event]
  (and (valid-event? new-event)
       (let [k (event-key new-event)]
         (not (some #(= k (event-key %)) pending)))))

(defn merge-events
  "Fold a batch of freshly-observed events into the pending queue, dropping
   invalid and duplicate ones. Order-preserving: existing first, then new
   arrivals in the order given."
  [pending observed]
  (reduce (fn [acc e]
            (if (should-enqueue? acc e) (conj acc e) acc))
          (vec pending)
          observed))

;; ── provider / usage-limit detection ─────────────────────────────────────────

(def usage-limit-patterns
  "Signals that the Claude account/session hit a real usage limit — distinct
   from a mutation-testing 'cooldown window' (normal idle) which must NOT
   match here. Mirrors the swarm-token-cooldown-handling operator directive:
   a real limit says 'usage limit reached' / 'session limit' / 'resets at
   HH(:MM)' / 'X-hour limit' / 'approaching usage limit'."
  [#"(?i)hit your (session|usage) limit"
   #"(?i)usage limit reached"
   #"(?i)approaching (your )?usage limit"
   #"(?i)\b\d+\s*-?\s*hour limit\b"
   #"(?i)resets?\s+(at\s+)?\d{1,2}(:\d{2})?\s*(am|pm)?"])

(defn usage-limited?
  "Best-effort: does this pane/log text show a genuine provider usage-limit
   banner? Deliberately conservative — a bare 'cooldown' or 'NO_TASK' does
   not count (those are normal swarm idle)."
  [text]
  (boolean (and text (some #(re-find % text) usage-limit-patterns))))

(defn parse-reset-clock
  "Pulls the reset wall-clock out of a 'resets 7:50pm' / 'resets at 19:50'
   banner as {:hour :minute :ampm} (ampm nil for 24h). Pure — turning this
   into an absolute instant needs the current date and is the runtime's job.
   Returns nil when no reset time is present."
  [text]
  (when text
    (when-let [m (re-find #"(?i)resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?" text)]
      (let [[_ h mm ap] m]
        {:hour (parse-long h)
         :minute (if mm (parse-long mm) 0)
         :ampm (some-> ap str/lower-case)}))))

(defn reset-epoch-ms
  "Resolve a parsed {:hour :minute :ampm} reset clock to an absolute epoch-ms,
   relative to now-ms (passed in, never read from the system clock here so
   tests are deterministic). Assumes the reset is the NEXT occurrence of that
   wall-clock at/after now (rolls to tomorrow if it already passed today).
   tz-offset-ms is the local zone's offset from UTC so the wall-clock is
   interpreted in the operator's local time."
  [{:keys [hour minute ampm]} now-ms tz-offset-ms]
  (when hour
    (let [h24 (cond
                (= ampm "pm") (if (= hour 12) 12 (+ hour 12))
                (= ampm "am") (if (= hour 12) 0 hour)
                :else hour)
          day-ms 86400000
          local-now (+ now-ms tz-offset-ms)
          day-start (* day-ms (quot local-now day-ms))
          candidate-local (+ day-start (* h24 3600000) (* minute 60000))
          candidate-local (if (< candidate-local local-now)
                            (+ candidate-local day-ms)
                            candidate-local)]
      (- candidate-local tz-offset-ms))))

(defn next-provider-state
  "Provider-state transition. Keeps the runtime from thrashing Claude against
   an account-level limit (see swarm-token-cooldown-handling):
     :available + :limit-detected            -> :cooldown
     :cooldown  + :reset-elapsed / :available -> :available
   otherwise unchanged."
  [current signal]
  (case [current signal]
    [:available :limit-detected] :cooldown
    [:cooldown :reset-elapsed] :available
    [:cooldown :available] :available
    current))

(defn cooldown-elapsed?
  "True once now-ms has reached the recorded reset instant."
  [reset-ms now-ms]
  (boolean (and reset-ms (>= now-ms reset-ms))))

;; BL-305 (Bug HIGH, fail-open): two false-freeze defects fixed here.
;;   1. A usage-limit signal with NO parseable reset (nil) previously
;;      produced a {:state :cooldown :reset-ms nil} that cooldown-elapsed?
;;      can NEVER satisfy (nil never elapses) - an INDEFINITE freeze.
;;   2. A STALE pane banner took priority over an already-recorded
;;      cooldown and RE-DERIVED a fresh reset from scrollback every tick;
;;      reset-epoch-ms's own next-occurrence roll turns an hours-stale
;;      "resets 7:50pm" into "tomorrow 7:50pm" once today's 7:50pm has
;;      passed - a ~24h freeze that kept renewing off text nobody
;;      refreshed.
;; plausible-reset? is the sanity bound that kills the next-occurrence 24h
;; artifact: a resolved reset must be in the future AND within
;; plausible-max-ms of now, or it is treated the same as an unparseable
;; one (mis-parsed), never honored as a day-long freeze.
(defn- plausible-reset? [reset-ms now-ms plausible-max-ms]
  (boolean (and reset-ms (> reset-ms now-ms) (<= (- reset-ms now-ms) plausible-max-ms))))

(defn resolve-provider-state
  "The FAIL-OPEN provider-state decision. scan-provider-state (the thin,
   impure caller) gathers the SAME inputs it always has - a just-observed
   usage-limit banner's text/parsed reset, the persisted cooldown record,
   now-ms - plus two config knobs, and this returns exactly the
   {:state :reset-ms :reset-raw} shape its own callers already expect.

   Priority order (each an independently-testable branch):
     1. An ALREADY-recorded, not-yet-elapsed cooldown is AUTHORITATIVE on
        its own reset-ms - live pane text is never re-consulted while it
        is still cooling, so it can never be renewed/extended (fixes
        defect 2's 'every tick' half).
     2. A recorded cooldown whose reset has ALREADY elapsed resumes
        UNCONDITIONALLY this tick, even if the same (or any) usage-limit
        text still lingers in a pane - fresh evidence is required to
        (re-)enter cooldown on a LATER tick, never mere leftover
        scrollback on the very tick of resuming (fixes defect 2's
        'stale banner never lets you leave' half; scan-provider-state's
        own caller (tick!) clears the persisted record once this returns
        :available, so a genuinely NEW signal gets a fair, fresh
        evaluation on the next tick).
     3. A fresh usage-limit signal with no PRIOR record: a plausible,
        parseable, near-term reset genuinely freezes until it (no
        regression); anything else (nil, or implausibly far - defect 1 +
        the sanity bound) caps to a SHORT bounded-fallback-ms window
        instead of an unbounded/never-elapsing one.
     4. No signal, no record - available."
  [{:keys [limited-text parsed-reset-ms reset-raw existing-reset-ms existing-reset-raw now-ms
           bounded-fallback-ms plausible-max-ms]}]
  (cond
    (and existing-reset-ms (< now-ms existing-reset-ms))
    {:state :cooldown :reset-ms existing-reset-ms :reset-raw existing-reset-raw}

    existing-reset-ms
    {:state :available}

    limited-text
    (if (plausible-reset? parsed-reset-ms now-ms plausible-max-ms)
      {:state :cooldown :reset-ms parsed-reset-ms :reset-raw reset-raw}
      {:state :cooldown :reset-ms (+ now-ms bounded-fallback-ms) :reset-raw reset-raw})

    :else
    {:state :available}))

;; ── the launch decision (the money question) ─────────────────────────────────

(defn should-launch-operator?
  "The single gate on spending tokens: launch the disposable LLM Operator
   only when there is something to reason about, none is already running, and
   the provider is not in cooldown. This is what makes idle time free."
  [{:keys [llm-running? provider-state pending-count]}]
  (boolean (and (not llm-running?)
                (= provider-state :available)
                (pos? (or pending-count 0)))))

;; ── BL-306: ask + await a clarifying answer ────────────────────────────────
;; The disposable Operator LLM can ASK one clarifying question then MUST
;; exit (it can never wait); the always-alive runtime holds the
;; awaiting-answer state {:question :thread-id :asked-at-ms} across ticks
;; and pairs a later reply / times it out. All decisions here are pure and
;; injected-clock (de0991e); operator_runtime.bb is the thin caller that
;; reads/writes the actual awaiting-answer.json and posts the escalation.

;; Duplicated from support_lib.bb's own (private) operator-channel/
;; human-message? rather than cross-namespace-coupled to it - a one-line
;; constant, the SAME "small live-glue duplicated across independent pure
;; libs, no shared lifecycle worth coupling" posture already used
;; elsewhere in this codebase (see gateSnapshot.ts's own header comment).
(def ^:private operator-channel-name "operator")

(defn resolve-pending-answer
  "True when a just-dispatched thread-id is THE SAME thread a pending
   question was asked in - the unambiguous MVP pairing rule (ONE pending
   question at a time; the next reply in that one thread is the answer)."
  [awaiting thread-id]
  (boolean (and awaiting thread-id (= (:thread-id awaiting) thread-id))))

(defn answer-text-from-messages
  "The human's own LATEST reply text out of a thread's messages - the
   plain-text 'answer' to pair alongside :pending-question in the
   dispatched context. nil when the thread carries no non-operator
   message at all (should not happen for a genuine reply-triggered
   dispatch, but never a crash over a blank pairing)."
  [messages]
  (:text (last (remove #(= (:channel %) operator-channel-name) messages))))

(defn await-timeout-elapsed?
  "True once now-ms has reached asked-at-ms + timeout-ms. nil asked-at-ms
   (nothing pending) never elapses - mirrors cooldown-elapsed?'s own
   nil-safe polarity above."
  [asked-at-ms now-ms timeout-ms]
  (boolean (and asked-at-ms (>= (- now-ms asked-at-ms) timeout-ms))))

(defn check-awaiting-answer
  "The BOUNDED escalate-once-then-drop decision for a pending clarifying-
   question await. awaiting = {:question :thread-id :asked-at-ms} or nil
   (nothing pending). Escalate and drop happen TOGETHER, in the SAME
   timeout crossing - there is no persisted 'escalated but still waiting'
   state, matching the ticket's own 'escalate once THEN clear' (never a
   second, later timeout, never an endless re-ask, never a guess at the
   answer). Returns {:event :escalate-and-drop :question :thread-id} or
   {:event nil}."
  [awaiting now-ms timeout-ms]
  (if (and awaiting (await-timeout-elapsed? (:asked-at-ms awaiting) now-ms timeout-ms))
    {:event :escalate-and-drop :question (:question awaiting) :thread-id (:thread-id awaiting)}
    {:event nil}))

;; ── swarm-check timer ─────────────────────────────────────────────────────────

(defn timer-due?
  "Has interval-ms elapsed since the last swarm check? last-ms nil (never
   run) counts as due so the first tick fires."
  [last-ms now-ms interval-ms]
  (or (nil? last-ms) (>= (- now-ms last-ms) interval-ms)))

;; ── agent liveness (pure, given already-gathered observations) ────────────────

(defn parse-roles-tsv
  "roles.tsv → [{:role :branch :worktree :session :window :provider ...}].
   Tolerant of blank lines and short rows."
  [text]
  (->> (str/split-lines (or text ""))
       (remove str/blank?)
       (map (fn [line]
              (let [f (str/split line #"\t")]
                {:role (nth f 0 nil)
                 :branch (nth f 1 nil)
                 :worktree (nth f 2 nil)
                 :session (nth f 3 nil)
                 :window (nth f 4 nil)
                 :provider (nth f 5 nil)})))
       (filter :role)
       vec))

(defn dead-agent-events
  "Given the sessions roles.tsv expects and the set of sessions tmux
   actually reports live, produce one AGENT_EXITED event per missing role.
   The runtime decides nothing about recovery — that is the LLM's call; this
   only surfaces the fact."
  [expected-roles live-sessions]
  (let [live (set live-sessions)]
    (->> expected-roles
         (remove #(contains? live (:session %)))
         (map (fn [{:keys [role session]}]
                {:type "AGENT_EXITED" :subject role
                 :detail (str "tmux session " session " not live")}))
         vec)))

;; ── status document (v2 schema) ───────────────────────────────────────────────

(defn render-status
  "Build the status map the runtime publishes to operator.status.json. Pure:
   the caller stamps :updated_at. Shape matches the Operator v2 spec."
  [{:keys [state llm-running? provider provider-state agents-running pending-count]}]
  {:state (name (or state :idle))
   :llm_running (boolean llm-running?)
   :provider (or provider "claude")
   :provider_state (name (or provider-state :available))
   :agents_running (or agents-running 0)
   :pending_events (or pending-count 0)})

;; ── BL-307: auto-hibernate on drain + mandatory closing pass ────────────────
;; The whole-swarm park/relaunch transition a human has done by hand (see
;; memory swarm-profiles-full-forge-concierge-banked): back up + empty
;; roles.tsv and kill the build-agent tmux session once fully drained, and
;; reverse it the moment new promotable work arrives. The predicates below
;; mirror should-launch-operator?'s own shape (injected state, no I/O); the
;; two adapter-injected orchestration fns mirror support_lib.bb's
;; check-linked-ticket-status! shape - the ONLY place the actual
;; backup/empty/kill/restore/relaunch actions happen, always through an
;; adapters map so a test can spy on which actions ran without a real tmux
;; socket.

(defn paused-item-pull-eligible?
  "A backlog/paused/ item is promotable unless it is explicitly parked
   status: blocked - any other status (or none at all) is pull-eligible. A
   blocked ticket (e.g. waiting on a human hardware step) must never
   permanently block the closing pass."
  [{:keys [status]}]
  (not= status "blocked"))

;; ── BL-318: self-generated provenance + the hibernation quiet-period gate ──
;; BL-307's auto-hibernation was structurally unreachable: the coordinator
;; writes itself a new paused ticket the moment the backlog empties (BL-311,
;; BL-314-317 all landed this way), and ANY pull-eligible paused item
;; (self-generated or not) made backlog-drained? false - so "drained" and
;; "coordinator just self-generated more work" were mutually exclusive by
;; construction, and hibernation could never fire. This section breaks that
;; circularity: a self-generated paused item no longer counts as pending
;; work for drainage purposes, and a NEW gate stops the coordinator from
;; promoting one while the swarm would otherwise hibernate.

(def self-generated-source-marker
  "The one honest-provenance marker (see format-self-generated-source) -
   self-generated-item? below looks for this exact substring, never a
   softer heuristic (guessing at phrasing) that could mis-classify a
   legitimately human/Operator/role-raised ticket as self-generated, or
   vice versa."
  "(self-generated)")

(defn format-self-generated-source
  "The WRITE-PATH helper: the one place a self-generated ticket's source
   line is composed, so honest provenance is a property of the tool, not
   of an LLM remembering to phrase it correctly each time (BL-326's own
   lesson, recurring: a guard that lives only in an author's memory has
   already cost this swarm a real incident once). Produces the exact
   string self-generated-item? recognizes."
  [reason]
  (str "Raised by the coordinator itself " self-generated-source-marker " - " reason))

(defn self-generated-item?
  "True when a backlog item's :source field carries the canonical
   self-generated marker. An item with no :source at all, or one that
   doesn't carry the marker, is NOT self-generated - the conservative
   default, so an ordinary human/Operator/role-raised ticket (the
   overwhelming majority, and everything the existing paused-item-pull-
   eligible? tests already cover) is completely unaffected by this."
  [{:keys [source]}]
  (boolean (and source (str/includes? source self-generated-source-marker))))

(defn honest-source?
  "True unless a ticket BOTH claims human origin in its source text AND is
   actually self-generated - the exact BL-314 provenance bug (source text
   said 'Raised by the human...' for a ticket that traced to the
   coordinator's own cost analysis). actually-self-generated? is supplied
   by the caller (the one place that genuinely knows origin at write
   time) - this function only catches the CONTRADICTION between a claim
   and that known fact, it can never independently detect a lie from text
   alone."
  [source actually-self-generated?]
  (not (and actually-self-generated?
            (boolean (and source (str/includes? (str/lower-case source) "raised by the human")))
            (not (self-generated-item? {:source source})))))

(defn paused-item-blocks-hibernation?
  "A paused item blocks hibernation when it is pull-eligible (not blocked)
   AND not self-generated. Self-generated work sitting in paused/ must
   never itself be the reason hibernation can't fire - that circularity is
   exactly BL-318's own defect."
  [item]
  (and (paused-item-pull-eligible? item) (not (self-generated-item? item))))

(defn backlog-drained?
  "No promotable, non-self-generated work remains: backlog/active/ is
   empty AND no paused item is currently pull-eligible AND not self-
   generated (BL-318 - a self-generated paused item no longer blocks
   drainage/hibernation, closing BL-307's own structurally-unreachable
   gap)."
  [active-count paused-items]
  (and (zero? (or active-count 0))
       (not-any? paused-item-blocks-hibernation? paused-items)))

(defn quiet-period-active?
  "True when the swarm sits in the down-trigger's own condition (drained +
   idle roster, using backlog-drained?'s own BL-318 definition above) -
   the state in which hibernation is eligible to fire on this tick."
  [{:keys [backlog-drained? roster-idle?]}]
  (boolean (and backlog-drained? roster-idle?)))

(defn promotion-blocked-by-quiet-period?
  "The gate BL-318 adds to the coordinator's own promotion decision: a
   SELF-GENERATED candidate must not be promoted while quiet-period-
   active? holds - hibernate wins over self-promotion. A human/Operator/
   other-role-raised candidate is NEVER blocked by this regardless of
   quiet-period state; only self-generation created the circularity this
   ticket fixes, so only self-generation is gated by it."
  [candidate-item quiet-state]
  (boolean (and (self-generated-item? candidate-item)
                (quiet-period-active? quiet-state))))

(defn role-idle?
  "A roster role blocks hibernation while it holds a pending inbox item or
   an in-process task."
  [{:keys [inbox-new-count in-process-count]}]
  (and (zero? (or inbox-new-count 0)) (zero? (or in-process-count 0))))

(defn roster-idle?
  "Every role in the CURRENT roster is idle. A role simply absent from the
   roster (e.g. lean-drain has no architect/hardener/documenter/cleaner)
   never appears here at all, so it is trivially quiescent - and an empty
   roster is vacuously idle."
  [role-states]
  (every? role-idle? role-states))

;; BL-310: the seed-race launch-grace guard. A freshly (re)started runtime
;; evaluates the closing pass on its very first tick, which can land on the
;; NORMAL post-launch state (backlog drained, roster idle) before the
;; coordinator has had any chance to wake and triage pending intake - the
;; feature eating the very launch meant to feed it. within-launch-grace? is
;; a cold-start guard ONLY: it does not change hibernate/relaunch behavior
;; once the grace period elapses, and does not apply across ordinary
;; hibernate/relaunch cycles that happen without the process itself
;; restarting.
(defn within-launch-grace?
  "True while now-ms is still within grace-ms of the runtime's OWN process
   start (started-at-ms). started-at-ms nil (no long-running process start
   was ever recorded - e.g. a one-shot --tick-once evaluation, which is not
   the always-alive runtime this guard protects) is NOT in grace, matching
   pre-BL-310 behavior exactly when there is no process lifetime to gate on."
  [started-at-ms now-ms grace-ms]
  (boolean (and started-at-ms (< (- now-ms started-at-ms) grace-ms))))

(defn should-hibernate?
  "The DOWN-TRIGGER: fires only on the intersection of a drained backlog, an
   idle roster, not already hibernated, and PAST the launch grace window
   (BL-310) - re-hibernating would back up an already-emptied roster over
   the real one, and hibernating inside the grace window would eat the very
   launch meant to let the coordinator triage pending intake."
  [{:keys [backlog-drained? roster-idle? already-hibernated? within-launch-grace?]}]
  (boolean (and backlog-drained? roster-idle? (not already-hibernated?) (not within-launch-grace?))))

(defn should-relaunch?
  "The UP-TRIGGER: while hibernated, new promotable work arriving (the
   backlog is no longer drained) triggers an automatic relaunch - and so
   does (BL-310) fresh coordinator mail arriving, even with no promotable
   ticket yet, so a hibernated swarm can still wake to let the coordinator
   triage newly-arrived intake."
  [{:keys [already-hibernated? backlog-drained? fresh-coordinator-mail?]}]
  (boolean (and already-hibernated? (or (not backlog-drained?) fresh-coordinator-mail?))))

(defn hibernate-swarm!
  "Adapter-injected: the exact hand-proven sequence - back up the roster,
   THEN empty it (order matters: emptying first would back up nothing),
   kill the build-agent tmux sessions, and record the transition. adapters:
   :backup-roster! :empty-roster! :kill-swarm-tmux! (all fn []), and
   :write-hibernation-state! (fn [now-ms]) - the timestamp is a plain
   injected value, never read from the system clock here."
  [now-ms adapters]
  ((:backup-roster! adapters))
  ((:empty-roster! adapters))
  ((:kill-swarm-tmux! adapters))
  ((:write-hibernation-state! adapters) now-ms)
  {:hibernated? true :at-ms now-ms})

(defn relaunch-swarm!
  "Adapter-injected up-trigger counterpart: restore the backed-up roster,
   bring the build-agent tmux sessions back up, then clear the hibernation
   state - in that order, so a crash mid-relaunch never leaves the state
   file claiming 'still hibernated' once the roster is already restored.
   adapters: :restore-roster! :relaunch-tmux! :clear-hibernation-state!
   (all fn [])."
  [now-ms adapters]
  ((:restore-roster! adapters))
  ((:relaunch-tmux! adapters))
  ((:clear-hibernation-state! adapters))
  {:relaunched? true :at-ms now-ms})

(defn evaluate-closing-pass!
  "One tick's full down/up-trigger evaluation: given the gathered pure state
   decides whether to hibernate or relaunch and, if so, performs it through
   the injected adapters. Mutually exclusive by construction - already-
   hibernated? gates which branch can even fire, so never both in the same
   tick. Returns {:action :hibernated|:relaunched|nil ...}."
  [{:keys [backlog-drained? roster-idle? already-hibernated? now-ms
           within-launch-grace? fresh-coordinator-mail?]} adapters]
  (cond
    (should-hibernate? {:backlog-drained? backlog-drained? :roster-idle? roster-idle?
                         :already-hibernated? already-hibernated?
                         :within-launch-grace? within-launch-grace?})
    (assoc (hibernate-swarm! now-ms adapters) :action :hibernated)

    (should-relaunch? {:already-hibernated? already-hibernated? :backlog-drained? backlog-drained?
                        :fresh-coordinator-mail? fresh-coordinator-mail?})
    (assoc (relaunch-swarm! now-ms adapters) :action :relaunched)

    :else {:action nil}))

;; Allow `bb operator_lib.bb` to be a no-op load (it is a library).
(when (= *file* (System/getProperty "babashka.file")) nil)
