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
    "TASK_ARRIVED"})      ; a new handoff/backlog item landed

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

;; ── the launch decision (the money question) ─────────────────────────────────

(defn should-launch-operator?
  "The single gate on spending tokens: launch the disposable LLM Operator
   only when there is something to reason about, none is already running, and
   the provider is not in cooldown. This is what makes idle time free."
  [{:keys [llm-running? provider-state pending-count]}]
  (boolean (and (not llm-running?)
                (= provider-state :available)
                (pos? (or pending-count 0)))))

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

;; Allow `bb operator_lib.bb` to be a no-op load (it is a library).
(when (= *file* (System/getProperty "babashka.file")) nil)
