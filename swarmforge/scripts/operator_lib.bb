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
    "SWARM_CONTROL_LOST"  ; BL-368: the tmux control channel itself did not
                           ; respond (socket gone/unlinked/errored) - a
                           ; DIFFERENT fact than any role having exited, and
                           ; must never be inferred FROM an AGENT_EXITED
                           ; batch or vice versa.
    "SWARM_CHECK_TIMER"   ; the periodic health/progress sweep fell due
    "HUMAN_COMMAND"       ; the operator's human dropped a command file
    "PROVIDER_AVAILABLE"  ; a usage-limit cooldown elapsed
    "PROVIDER_LIMIT_REACHED"
    "CONFIG_CHANGED"      ; swarmforge.conf or a launch script changed
    "TASK_ARRIVED"        ; a new handoff/backlog item landed
    "TELEGRAM_TOPIC_MESSAGE"  ; BL-281: an inbound Telegram forum-topic
                               ; message was demuxed to a SUP-### thread -
                               ; per-subject (:subject = the thread id,
                               ; like AGENT_EXITED/HUMAN_COMMAND/TASK_ARRIVED
                               ; below), never coalescing: a second message
                               ; on an ALREADY-pending thread still collapses
                               ; to one wake (event-key dedup), but a
                               ; DIFFERENT thread's message must survive as
                               ; its own distinct pending event.
    "TELEGRAM_BL_TOPIC_MESSAGE"}) ; BL-325: an inbound reply typed into a
                               ; BL-### backlog item's OWN topic (BL-298's
                               ; producer) - consumed deterministically by
                               ; operator_runtime.bb's bl-topic-approval-
                               ; sweep! every tick (see partition-bl-topic-
                               ; events below), never dispatched to the LLM
                               ; Operator's own reasoning.

(def coalescing-types
  "Event types where a second pending copy adds nothing — the LLM will
   re-observe full state anyway, so stacking duplicates just wastes a launch.
   AGENT_EXITED / HUMAN_COMMAND / TASK_ARRIVED are per-subject and are keyed
   separately (see event-key). SWARM_CONTROL_LOST has no subject - it is one
   fact about the whole swarm, not one per role - so it coalesces exactly
   like SWARM_CHECK_TIMER."
  #{"SWARM_CHECK_TIMER" "PROVIDER_AVAILABLE" "PROVIDER_LIMIT_REACHED" "CONFIG_CHANGED" "SWARM_CONTROL_LOST"})

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

(defn partition-bl-topic-events
  "BL-325: splits pending events into TELEGRAM_BL_TOPIC_MESSAGE events (a
   human's reply typed into a backlog item's own topic - to be consumed
   deterministically, THIS tick, by the approve relay) and everything else
   (left untouched for the normal dispatch/launch path). Consuming these
   here rather than folding them into an LLM Operator dispatch means the
   answer reaches the gated role's pane without waiting on an Opus launch -
   the ticket's own scenario-05 ordering guarantee (the item must not
   complete before the human's answer arrives)."
  [pending-events]
  (let [bl-topic? #(= (:type %) "TELEGRAM_BL_TOPIC_MESSAGE")]
    {:to-consume (filterv bl-topic? pending-events)
     :remaining (remove bl-topic? pending-events)}))

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

;; ── BL-334: the restricted front-desk Operator's launch gate ──────────────
;; A SECOND Operator, admitted ALONGSIDE the first, that exists only to
;; relieve front-desk starvation while the unrestricted Operator holds the
;; single slot indefinitely (an attended session never releases it, so
;; should-launch-operator? above can never fire for as long as it runs).
;; Eligible EXACTLY when the full Operator IS running - the caller passes
;; the SAME full-operator-running?/llm-running? fact to both this function
;; and should-launch-operator? in one tick, which makes the two mutually
;; exclusive by construction (literal negations of one input): they can
;; never both be eligible to claim the shared pending queue in the same
;; tick (restricted-front-desk-operator-05/06). When the full Operator is
;; NOT running, the ordinary should-launch-operator? path already drains
;; the queue exactly as it does today - this gate never engages then.

(defn should-launch-front-desk-operator?
  [{:keys [full-operator-running? front-desk-running? provider-state pending-count]}]
  (boolean (and full-operator-running?
                (not front-desk-running?)
                (= provider-state :available)
                (pos? (or pending-count 0)))))

;; The FULL self-contained prompt for the restricted front-desk Operator - it
;; holds no Read tool (see should-launch-front-desk-operator?'s docstring),
;; so everything it could need (the caller's own transcript, durable memory
;; facts) is inlined here rather than left for a tool it does not have.
;; Instructs it to reply with the answer text ALONE - the runtime treats the
;; ENTIRE completion as the reply, verbatim; there is no tool call for it to
;; structure output through.
(defn front-desk-reply-prompt
  [{:keys [transcript long-term-memory]}]
  (str
   "You are the front-desk Operator. You have NO tools and NO ability to act "
   "on the swarm in any way - you can only read what is given below and "
   "reply in plain text. Another Operator is mid-conversation elsewhere and "
   "must not be interrupted; your only job is to answer the human's message "
   "on this thread.\n\n"
   "Known long-term facts:\n" (pr-str long-term-memory) "\n\n"
   "Thread so far:\n" (pr-str transcript) "\n\n"
   "Reply with ONLY the message to send back to the human - no preamble, no "
   "explanation, just the reply text itself."))

;; The restricted front-desk Operator holds NO tool at all (launched with
;; `claude -p --tools ""` - see launch_front_desk_operator.sh), so its
;; completed text IS the whole of what it can communicate; there is no tool
;; call for it to post a reply through. front-desk-reply-text is the ONE
;; place that decides whether a captured `claude -p --output-format json`
;; result is usable - an error or a blank completion never becomes a
;; "reply", so the runtime never posts empty/garbage text to the human.
(defn front-desk-reply-text
  [{:keys [is_error result]}]
  (when (and (not is_error) (not (str/blank? (or result ""))))
    result))

;; restricted-front-desk-operator-07: the front-desk Operator's own status,
;; reported ALONGSIDE (never instead of, never overwriting) the full
;; Operator's render-status above. operator_runtime.bb nests this under one
;; :front_desk key inside the SAME status.json write render-status already
;; produces - one atomic write, so "neither has overwritten the other" is a
;; property of the wiring, not something either status shape has to encode.
(defn render-front-desk-status
  [{:keys [llm-running? pending-count]}]
  {:llm_running (boolean llm-running?)
   :pending_events (or pending-count 0)})

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

(defn resolve-inbound-answer
  "BL-354 Option C (same-thread-clears, human decision 2026-07-14): the
   three-way decision for an inbound reply against a pending clarifying
   question. The thread gate stays - a message in a thread OTHER than the
   one the question is currently homed to is never CONSUMED as the answer
   - but it is never silently lost either: the question follows the human
   to wherever he actually replies.

   awaiting = {:question :thread-id :asked-at-ms} or nil (nothing
   pending). Returns one of:
     {:outcome :none}                                 - no question pending at all;
                                                          an ordinary message.
     {:outcome :pair}                                  - thread-id matches the await's
                                                          own thread: today's behavior,
                                                          unchanged - this reply IS the
                                                          answer.
     {:outcome :re-home :question ... :asked-at-ms ...} - a question IS pending, in a
                                                          DIFFERENT thread: not the
                                                          answer. The caller re-posts
                                                          :question into thread-id and
                                                          re-homes the await there,
                                                          asked-at-ms UNCHANGED (BL-354's
                                                          own bounded-retry requirement -
                                                          the deadline runs from the
                                                          ORIGINAL ask, never reset by a
                                                          thread hop)."
  [awaiting thread-id]
  (cond
    (nil? awaiting) {:outcome :none}
    (= (:thread-id awaiting) thread-id) {:outcome :pair}
    :else {:outcome :re-home :question (:question awaiting) :asked-at-ms (:asked-at-ms awaiting)}))

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
   only surfaces the fact.

   BL-368: only ever called when the control channel itself is CONFIRMED
   reachable (tmux answered, however few sessions it reported) - never on a
   guess. A caller with an unreachable tmux socket must use
   control-lost-event below instead, never this function with whatever
   stale/empty session list it has lying around - the two are DIFFERENT
   FACTS about the world (agents dead vs. control lost) and must never
   collapse to the same N x AGENT_EXITED shape."
  [expected-roles live-sessions]
  (let [live (set live-sessions)]
    (->> expected-roles
         (remove #(contains? live (:session %)))
         (map (fn [{:keys [role session]}]
                {:type "AGENT_EXITED" :subject role
                 :detail (str "tmux session " session " not live")}))
         vec)))

;; BL-368: the single loud signal for "the control channel itself did not
;; respond" (socket file missing, unix socket unlinked, tmux errored) -
;; deliberately NEVER N x AGENT_EXITED, which the Operator prompt's own
;; scripted recovery reads as "respawn this role", corrupting the repo if
;; acted on while every role's claude process is actually still alive (the
;; live incident this ticket exists to prevent). One event, regardless of
;; roster size, because this is one fact about the world, not one per role.
(defn control-lost-event []
  {:type "SWARM_CONTROL_LOST"
   :detail "tmux control channel unreachable - this is NOT proof any agent died; do not relaunch based on this alone"})

;; ── status document (v2 schema) ───────────────────────────────────────────────

;; BL-333: `state` alone conflates "an Operator process is alive" with
;; "events are being processed" - it only ever reports the first. An
;; ATTENDED (interactive) Operator holds the SAME single-Operator slot a
;; disposable one would (operator-running? cannot tell them apart) and is
;; instructed never to release it, so should-launch-operator? (which
;; requires `not llm-running?`) can NEVER fire while it is up - nothing can
;; drain the queue, however many events pile up behind it. Computed, never
;; caller-supplied, so render-status can't be handed an inconsistent value.
(defn queue-consuming?
  "Is the front desk's inbound queue actively being drained? False exactly
   when a live Operator holds the slot AND events are pending - that is
   precisely the state should-launch-operator? can never dispatch from."
  [llm-running? pending-count]
  (boolean (not (and llm-running? (pos? (or pending-count 0))))))

(defn render-status
  "Build the status map the runtime publishes to operator.status.json. Pure:
   the caller stamps :updated_at. Shape matches the Operator v2 spec.
   BL-333: queue_consuming is DERIVED here (never a raw pass-through) so
   'an Operator alive' and 'consuming nothing' are always reported as two
   independently-readable, mutually-consistent facts, not one field a
   reader has to infer the second fact from over multiple ticks."
  [{:keys [state llm-running? provider provider-state agents-running pending-count oldest-pending-age-ms]}]
  {:state (name (or state :idle))
   :llm_running (boolean llm-running?)
   :provider (or provider "claude")
   :provider_state (name (or provider-state :available))
   :agents_running (or agents-running 0)
   :pending_events (or pending-count 0)
   :queue_consuming (queue-consuming? llm-running? pending-count)
   :oldest_pending_event_age_ms oldest-pending-age-ms})

;; ── BL-333: front-desk starvation detection + edge-triggered alarm ─────────
;; Both trigger conditions matter independently (the ticket's own words: "3
;; events unread for two days is starvation just as much as 25 events
;; unread for an hour, and a count-only trigger misses the slow case").

(defn queue-backlog-started-at-ms
  "The persisted marker this tick should carry forward: nil once the queue
   drains to empty (nothing left to age), the SAME marker while it stays
   non-empty (the age counts from when the CURRENT unbroken backlog began,
   never resets while events keep piling up), or now-ms the instant it
   first goes from empty to non-empty."
  [prev-marker-ms pending-count now-ms]
  (cond
    (zero? (or pending-count 0)) nil
    prev-marker-ms prev-marker-ms
    :else now-ms))

(defn front-desk-starving?
  "True when the queue has backed up past EITHER configured limit: too many
   events waiting, or the oldest one waiting too long. Either alone is
   starvation - never require both."
  [{:keys [pending-count oldest-pending-age-ms count-limit age-limit-ms]}]
  (boolean (or (and count-limit (> (or pending-count 0) count-limit))
               (and age-limit-ms oldest-pending-age-ms (> oldest-pending-age-ms age-limit-ms)))))

;; ── BL-345: delivery-based arming ────────────────────────────────────────
;; BL-333's starvation-alarm-decision above armed on the ATTEMPT (`(boolean
;; starving?)`, computed and persisted BEFORE the send even ran) and
;; discarded send-configured-email!'s own result - a transient failure at
;; the exact tick starvation crossed the threshold silently suppressed the
;; alarm for the WHOLE episode (days). The engineering article's own rule
;; (2nd occurrence of BL-215's defect class): a repeat-suppression flag must
;; be set on CONFIRMED DELIVERY, never on a delivery attempt. These three
;; functions replace the old edge-triggered-on-attempt decision with
;; delivery-based arming: armed? now reflects whether the alarm was
;; actually DELIVERED, or a retry can never help (terminal misconfig) -
;; never whether a send was merely attempted.

(def terminal-misconfig-reasons
  "send-configured-email!/send-alarm-email! :reason values for which
   retrying can never help. :test-fixture-suppressed is included - it must
   never reach the network and must never be treated as a real delivery
   failure that would burn a retry attempt (it is not a failure at all,
   just a test fixture's send being redirected away from the network)."
  #{:disabled :missing-api-key :test-fixture-suppressed})

(defn classify-delivery-result
  "Classifies a send result map ({:success bool :reason kw? :error str?})
   into :delivered, :terminal-misconfig (retrying can never help - warn
   once, arm), or :transient-failure (a real send attempt failed with no
   :reason - HTTP non-2xx, DNS, timeout - retry it, bounded)."
  [{:keys [success reason]}]
  (cond
    success :delivered
    (contains? terminal-misconfig-reasons reason) :terminal-misconfig
    :else :transient-failure))

(defn compute-alarm-backoff-ms
  "Exponential backoff capped at backoff-max-ms - same shape as
   front-desk-supervisor-lib's own compute-backoff-ms (this project's
   established bounded-retry-with-backoff convention), independently
   defined here rather than cross-namespace-coupled - same small-
   duplication rationale as this file's other independent adapters (e.g.
   operator-runtime.bb's own read-yaml-field)."
  [attempt {:keys [backoff-base-ms backoff-max-ms]}]
  (long (min (* backoff-base-ms (Math/pow 2 (max 0 (dec (or attempt 1)))))
             backoff-max-ms)))

(defn starvation-alarm-should-attempt?
  "Should THIS tick attempt to send/re-send the starvation alarm? Never
   once armed? (the anti-spam guard) or once starving? has cleared. The
   FIRST attempt of a fresh starvation (delivery-attempts zero/nil) is
   always due; a RETRY after a transient failure is due only once the
   backoff computed from delivery-attempts has elapsed since
   last-attempt-at-ms - never hammer the send on every tick."
  [{:keys [starving? armed? delivery-attempts last-attempt-at-ms now-ms retry-config]}]
  (boolean
   (and starving? (not armed?)
        (or (zero? (or delivery-attempts 0))
            (nil? last-attempt-at-ms)
            (>= (- now-ms last-attempt-at-ms)
                (compute-alarm-backoff-ms delivery-attempts retry-config))))))

(defn next-starvation-alarm-state
  "Given the outcome of an attempted send this tick, computes the next
   persisted {:armed? :delivery-attempts :last-attempt-at-ms} plus
   :gave-up? true when a transient failure just exhausted the retry cap
   (the caller's cue to log the undelivered alarm loudly). :delivered and
   :terminal-misconfig both arm immediately - retrying either can never
   help. :transient-failure never arms; it increments the attempt counter
   so the next tick's should-attempt? backs off, UNLESS the cap is reached,
   in which case it arms anyway (never retry forever) and gives up loudly."
  [outcome {:keys [delivery-attempts]} {:keys [max-attempts]} now-ms]
  (case outcome
    (:delivered :terminal-misconfig)
    {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil :gave-up? false}

    :transient-failure
    (let [next-attempts (inc (or delivery-attempts 0))]
      (if (>= next-attempts max-attempts)
        {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil :gave-up? true}
        {:armed? false :delivery-attempts next-attempts :last-attempt-at-ms now-ms :gave-up? false}))))

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

;; ── BL-371: passing a question down (raw intake, backlog root) ───────────
;; The Operator's only path for a question it cannot answer itself, distinct
;; from hand-off-to-coordinator! (support_lib.bb) which requires a
;; PRE-EXISTING ticket - this one has none. Deliberately files into the
;; SAME backlog-root raw-intake channel a human uses directly (constitution:
;; Backlog Intake Order), never a new queue/routing authority - the
;; specifier's existing drain-root-first convention picks it up with zero
;; new machinery. The Operator FILES only; it never creates/specs/promotes
;; the resulting ticket itself (same anti-fabrication posture as
;; hand-off-to-coordinator!).

(defn question-intake-slug
  "A stable, filename-safe slug for a raw-question intake file - millisecond
   epoch is sufficient (this is a human-facing filename, not an id anything
   else joins against; two questions in the same millisecond is not a real
   scenario for a Telegram round trip)."
  [now-ms]
  (str "operator-question-" now-ms))

(defn question-intake-content
  "The raw intake file's own content - a PROPOSAL only, matching support_
   lib.bb's build-intake-content wording exactly for the ticket-linked case:
   the specifier owns turning this into a real spec, this function never
   drafts acceptance criteria or picks a priority."
  [question-text now-iso]
  (str "# Intake: a question the Operator could not answer\n\n"
       "Filed by the Operator (" now-iso ") - a question came in via Telegram\n"
       "that the Operator judged it could not answer itself. This is a RAW\n"
       "ask, not a spec: the specifier drains this like any other backlog-root\n"
       "item and decides what (if anything) becomes a real ticket.\n\n"
       "## The question\n\n"
       question-text "\n"))

;; Allow `bb operator_lib.bb` to be a no-op load (it is a library).
(when (= *file* (System/getProperty "babashka.file")) nil)
