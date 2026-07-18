#!/usr/bin/env bb
;; TDD runner for operator_lib.bb's pure functions (Operator v2) — no
;; filesystem, no tmux, no clock. Mirrors migrate_gherkin_test_runner.bb.

(ns operator-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "operator_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; ── event validity + dedup ────────────────────────────────────────────────
(assert-true "known event type is valid" (operator-lib/valid-event? {:type "SWARM_CHECK_TIMER"}))
(assert-false "unknown event type is invalid" (operator-lib/valid-event? {:type "NONSENSE"}))

(assert= "coalescing type keys to type alone"
         "SWARM_CHECK_TIMER"
         (operator-lib/event-key {:type "SWARM_CHECK_TIMER" :subject "ignored"}))
(assert= "subject-bearing type keeps its subject"
         "AGENT_EXITED coder"
         (operator-lib/event-key {:type "AGENT_EXITED" :subject "coder"}))

(assert-false "do not stack a duplicate timer"
              (operator-lib/should-enqueue? [{:type "SWARM_CHECK_TIMER"}] {:type "SWARM_CHECK_TIMER"}))
(assert-true "two different dead agents both enqueue"
             (operator-lib/should-enqueue? [{:type "AGENT_EXITED" :subject "coder"}]
                                            {:type "AGENT_EXITED" :subject "QA"}))
(assert-false "unknown type never enqueues"
              (operator-lib/should-enqueue? [] {:type "???"}))

(assert= "merge-events drops dup timer, keeps distinct agents"
         [{:type "SWARM_CHECK_TIMER"} {:type "AGENT_EXITED" :subject "coder"}]
         (operator-lib/merge-events
          [{:type "SWARM_CHECK_TIMER"}]
          [{:type "SWARM_CHECK_TIMER"} {:type "AGENT_EXITED" :subject "coder"}]))

;; ── BL-281: TELEGRAM_TOPIC_MESSAGE is per-subject, not coalescing ─────────
(assert-true "TELEGRAM_TOPIC_MESSAGE is a valid event type"
             (operator-lib/valid-event? {:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}))
(assert= "TELEGRAM_TOPIC_MESSAGE keys by its subject (the thread id), like AGENT_EXITED"
         "TELEGRAM_TOPIC_MESSAGE SUP-1"
         (operator-lib/event-key {:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}))
(assert-false "a second message for an ALREADY-pending thread coalesces to one wake"
              (operator-lib/should-enqueue? [{:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}]
                                             {:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}))
(assert-true "a message for a DIFFERENT thread still enqueues as its own event"
             (operator-lib/should-enqueue? [{:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}]
                                            {:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-2"}))

;; ── BL-325: TELEGRAM_BL_TOPIC_MESSAGE is a valid, dedicated event type ────
(assert-true "TELEGRAM_BL_TOPIC_MESSAGE is a valid event type"
             (operator-lib/valid-event? {:type "TELEGRAM_BL_TOPIC_MESSAGE" :backlogId "BL-316"}))

;; ── BL-325: partition-bl-topic-events splits the deterministic consumer's
;;    own batch out of the pending queue, leaving everything else untouched ─
(assert= "no BL-topic events: to-consume empty, remaining unchanged"
         {:to-consume [] :remaining [{:type "SWARM_CHECK_TIMER"}]}
         (operator-lib/partition-bl-topic-events [{:type "SWARM_CHECK_TIMER"}]))

(assert= "a BL-topic event is pulled into to-consume, remaining stays as everything else"
         {:to-consume [{:type "TELEGRAM_BL_TOPIC_MESSAGE" :backlogId "BL-316" :text "yes, approved"}]
          :remaining [{:type "SWARM_CHECK_TIMER"}]}
         (operator-lib/partition-bl-topic-events
          [{:type "TELEGRAM_BL_TOPIC_MESSAGE" :backlogId "BL-316" :text "yes, approved"}
           {:type "SWARM_CHECK_TIMER"}]))

(assert= "two different BL-topic events both survive into to-consume"
         {:to-consume [{:type "TELEGRAM_BL_TOPIC_MESSAGE" :backlogId "BL-316" :text "a"}
                       {:type "TELEGRAM_BL_TOPIC_MESSAGE" :backlogId "BL-317" :text "b"}]
          :remaining []}
         (operator-lib/partition-bl-topic-events
          [{:type "TELEGRAM_BL_TOPIC_MESSAGE" :backlogId "BL-316" :text "a"}
           {:type "TELEGRAM_BL_TOPIC_MESSAGE" :backlogId "BL-317" :text "b"}]))

;; ── usage-limit detection ─────────────────────────────────────────────────
(assert-true "detects 'hit your session limit'"
             (operator-lib/usage-limited? "You've hit your session limit · resets 7:50pm (Europe/London)"))
(assert-true "detects 'usage limit reached'"
             (operator-lib/usage-limited? "Claude usage limit reached. Try again later."))
(assert-true "detects 'approaching usage limit'"
             (operator-lib/usage-limited? "You are approaching your usage limit"))
(assert-true "detects 'resets at 19:50'"
             (operator-lib/usage-limited? "limited — resets at 19:50"))
(assert-false "a mutation cooldown window is NOT a usage limit"
              (operator-lib/usage-limited? "cooldown window. Inbox empty (NO_TASK); idling"))
(assert-false "plain idle is not a usage limit"
              (operator-lib/usage-limited? "Queue is empty (NO_TASK), stopping here per protocol."))

(assert= "parses 12h reset clock '7:50pm'"
         {:hour 7 :minute 50 :ampm "pm"}
         (operator-lib/parse-reset-clock "resets 7:50pm (Europe/London)"))
(assert= "parses 24h reset clock 'resets at 19:50'"
         {:hour 19 :minute 50 :ampm nil}
         (operator-lib/parse-reset-clock "resets at 19:50"))
(assert= "parses bare-hour reset '3pm'"
         {:hour 3 :minute 0 :ampm "pm"}
         (operator-lib/parse-reset-clock "resets 3pm"))
(assert= "no reset clock present -> nil"
         nil
         (operator-lib/parse-reset-clock "usage limit reached"))

;; reset-epoch-ms: interpret wall-clock in local tz, roll to next occurrence.
;; Use tz-offset 0 (UTC) and a fixed now for determinism.
;; now = 1970-01-01T10:00:00Z = 36000000 ms.
(let [now 36000000]
  (assert= "reset 11:00 (same day, future) resolves to today 11:00"
           (+ (* 11 3600000))
           (operator-lib/reset-epoch-ms {:hour 11 :minute 0 :ampm nil} now 0))
  (assert= "reset 09:00 (already passed) rolls to tomorrow 09:00"
           (+ 86400000 (* 9 3600000))
           (operator-lib/reset-epoch-ms {:hour 9 :minute 0 :ampm nil} now 0))
  (assert= "reset 7:50pm -> today 19:50"
           (+ (* 19 3600000) (* 50 60000))
           (operator-lib/reset-epoch-ms {:hour 7 :minute 50 :ampm "pm"} now 0)))

;; ── provider-state machine ────────────────────────────────────────────────
(assert= "available + limit -> cooldown"
         :cooldown (operator-lib/next-provider-state :available :limit-detected))
(assert= "cooldown + reset-elapsed -> available"
         :available (operator-lib/next-provider-state :cooldown :reset-elapsed))
(assert= "cooldown + limit-again stays cooldown"
         :cooldown (operator-lib/next-provider-state :cooldown :limit-detected))
(assert= "available + available stays available"
         :available (operator-lib/next-provider-state :available :available))

(assert-true "cooldown elapsed once now reaches reset" (operator-lib/cooldown-elapsed? 100 100))
(assert-false "cooldown not elapsed before reset" (operator-lib/cooldown-elapsed? 200 100))
(assert-false "nil reset never elapsed" (operator-lib/cooldown-elapsed? nil 999999))

;; ── the launch gate ───────────────────────────────────────────────────────
(assert-true "launch when idle-capacity + available + pending"
             (operator-lib/should-launch-operator? {:llm-running? false :provider-state :available :pending-count 2}))
(assert-false "do NOT launch when one is already running"
              (operator-lib/should-launch-operator? {:llm-running? true :provider-state :available :pending-count 2}))
(assert-false "do NOT launch during cooldown even with pending work"
              (operator-lib/should-launch-operator? {:llm-running? false :provider-state :cooldown :pending-count 5}))
(assert-false "do NOT launch when nothing is pending"
              (operator-lib/should-launch-operator? {:llm-running? false :provider-state :available :pending-count 0}))

;; ── timer ─────────────────────────────────────────────────────────────────
(assert-true "never-run timer is due" (operator-lib/timer-due? nil 1000 500))
(assert-true "interval elapsed is due" (operator-lib/timer-due? 0 600 500))
(assert-false "interval not elapsed is not due" (operator-lib/timer-due? 400 600 500))

;; ── BL-481: out-of-cycle poll wait/launch decision ─────────────────────────
(assert= "resolve-poll-interval-ms passes through a sane configured value"
         5000 (operator-lib/resolve-poll-interval-ms 5000))
(assert= "resolve-poll-interval-ms clamps a zero value to the 1s floor"
         1000 (operator-lib/resolve-poll-interval-ms 0))
(assert= "resolve-poll-interval-ms clamps a negative value to the 1s floor"
         1000 (operator-lib/resolve-poll-interval-ms -500))
(assert= "resolve-poll-interval-ms falls back to 3000 when nil, still above the floor"
         3000 (operator-lib/resolve-poll-interval-ms nil))

;; base fixture for next-poll-decision: idle, listening, nothing pending
(def idle-poll-fixture
  {:llm-running? false :front-desk-running? false :provider-state :available
   :pending-count 0 :front-desk-pending-count 0 :poll-interval-ms 3000})

(assert= "operator-out-of-cycle-wake-01: idle-and-listening decides the short poll wait, never OPERATOR_INTERVAL_MS"
         3000 (:wait-ms (operator-lib/next-poll-decision idle-poll-fixture)))
(assert-true "operator-out-of-cycle-wake-01: the decided wait is genuinely short, not the 30s default full interval"
             (< (:wait-ms (operator-lib/next-poll-decision idle-poll-fixture)) 30000))

(assert-true "operator-out-of-cycle-wake-02: a fresh inbound message pending, nothing running, provider available - launches"
             (:launch? (operator-lib/next-poll-decision
                        (assoc idle-poll-fixture :pending-count 1))))

(assert-false "operator-out-of-cycle-wake-03: full-operator-running guard blocks the fast-path launch"
              (:launch? (operator-lib/next-poll-decision
                         (assoc idle-poll-fixture :llm-running? true :pending-count 1))))
(assert-false "operator-out-of-cycle-wake-03: front-desk-operator-running guard blocks the fast-path front-desk launch"
              (:launch-front-desk? (operator-lib/next-poll-decision
                                    (assoc idle-poll-fixture
                                           :llm-running? true :front-desk-running? true
                                           :front-desk-pending-count 1))))
(assert-false "operator-out-of-cycle-wake-03: provider-cooldown guard blocks the fast-path launch"
              (:launch? (operator-lib/next-poll-decision
                         (assoc idle-poll-fixture :provider-state :cooldown :pending-count 1))))

;; Simulates many short poll wakes (every 3s) across ONE swarm-check-ms
;; (1,800,000ms) window - starting right after a swarm check already fired
;; at t=0 (last-ms=0), each poll re-checks timer-due? against whatever
;; last-ms the PRIOR fire recorded, the same state-threading the real
;; runtime's record-swarm-check! does. Proves the sweep fires zero more
;; times while still inside that window, then fires exactly once the
;; instant the NEXT cadence becomes due.
(let [swarm-check-ms 1800000
      poll-ms 3000
      wake-times-inside-window (range poll-ms swarm-check-ms poll-ms)
      fires (atom 0)
      last-ms (atom 0)]
  (doseq [now wake-times-inside-window]
    (when (operator-lib/timer-due? @last-ms now swarm-check-ms)
      (swap! fires inc)
      (reset! last-ms now)))
  (assert= "operator-out-of-cycle-wake-04: the full health sweep fires zero more times across many short poll wakes still inside one swarm-check cadence"
           0 @fires)
  (assert-true "operator-out-of-cycle-wake-04: the full health sweep fires once the NEXT swarm-check cadence becomes due"
               (operator-lib/timer-due? @last-ms swarm-check-ms swarm-check-ms)))

(assert-false "operator-out-of-cycle-wake-05: the poll interval is never a zero-delay spin, even misconfigured to 0"
              (zero? (operator-lib/resolve-poll-interval-ms 0)))

;; ── roles.tsv + dead-agent events ─────────────────────────────────────────
(def sample-roles
  "coder\tcoder\t/w/coder\tswarmforge-coder\tCoder\tclaude\ttask\toff\ncoordinator\tmaster\t/w\tswarmforge-coordinator\tCoordinator\tclaude\ttask\toff")

(assert= "parse-roles-tsv extracts role+session"
         [{:role "coder" :session "swarmforge-coder"}
          {:role "coordinator" :session "swarmforge-coordinator"}]
         (map #(select-keys % [:role :session]) (operator-lib/parse-roles-tsv sample-roles)))

(assert= "dead-agent-events flags the role whose session is not live"
         [{:type "AGENT_EXITED" :subject "QA" :detail "tmux session swarmforge-QA not live"}]
         (operator-lib/dead-agent-events
          [{:role "coder" :session "swarmforge-coder"}
           {:role "QA" :session "swarmforge-QA"}]
          ["swarmforge-coder"]))
(assert= "no dead agents when all sessions live"
         []
         (operator-lib/dead-agent-events
          [{:role "coder" :session "swarmforge-coder"}]
          ["swarmforge-coder" "swarmforge-QA"]))

;; ── status doc ────────────────────────────────────────────────────────────
(assert= "render-status matches the v2 schema"
         {:state "waiting_for_provider" :llm_running false :provider "claude"
          :provider_state "cooldown" :agents_running 8 :pending_events 3
          :queue_consuming true :oldest_pending_event_age_ms nil}
         (operator-lib/render-status {:state :waiting_for_provider :llm-running? false
                                      :provider "claude" :provider-state :cooldown
                                      :agents-running 8 :pending-count 3}))

;; ── BL-333: queue-consuming? / front-desk-starving? (BL-345: delivery-based
;;    arming - classify-delivery-result / starvation-alarm-should-attempt? /
;;    next-starvation-alarm-state - replaces the old attempt-based
;;    starvation-alarm-decision, see below) ──────────────────────────────
(assert-false "front-desk-starvation-alarm-01: a live Operator with events pending is NOT consuming"
              (operator-lib/queue-consuming? true 5))
(assert-true "an Operator with an EMPTY queue is still trivially 'consuming' (nothing to drain)"
             (operator-lib/queue-consuming? true 0))
(assert-true "no live Operator at all - should-launch-operator? can dispatch, so this is consuming"
             (operator-lib/queue-consuming? false 5))
(assert-true "no Operator, no events - consuming (healthy idle)"
             (operator-lib/queue-consuming? false 0))

(assert= "render-status reports queue_consuming/oldest age as independently-readable facts (01)"
         {:state "operator_running" :llm_running true :provider "claude"
          :provider_state "available" :agents_running 4 :pending_events 22
          :queue_consuming false :oldest_pending_event_age_ms 3600000}
         (operator-lib/render-status {:state :operator_running :llm-running? true
                                      :provider "claude" :provider-state :available
                                      :agents-running 4 :pending-count 22
                                      :oldest-pending-age-ms 3600000}))

(assert= "queue-backlog-started-at-ms: an empty queue has no marker"
         nil (operator-lib/queue-backlog-started-at-ms 1000 0 5000))
(assert= "queue-backlog-started-at-ms: a brand-new backlog stamps now-ms"
         5000 (operator-lib/queue-backlog-started-at-ms nil 3 5000))
(assert= "queue-backlog-started-at-ms: an ALREADY-tracked backlog keeps its original marker"
         1000 (operator-lib/queue-backlog-started-at-ms 1000 3 5000))

(assert-true "front-desk-starving?: over the count limit alone is starvation"
             (operator-lib/front-desk-starving? {:pending-count 26 :count-limit 5 :age-limit-ms 3600000}))
(assert-false "front-desk-starving?: AT the count limit (not over) is not yet starvation"
              (operator-lib/front-desk-starving? {:pending-count 5 :count-limit 5 :age-limit-ms 3600000}))
(assert-true "front-desk-starving?: a short queue that is simply OLD is still starvation (the slow case)"
             (operator-lib/front-desk-starving? {:pending-count 1 :oldest-pending-age-ms 7200000
                                                 :count-limit 5 :age-limit-ms 3600000}))
(assert-false "front-desk-starving?: under both limits is healthy"
              (operator-lib/front-desk-starving? {:pending-count 2 :oldest-pending-age-ms 60000
                                                  :count-limit 5 :age-limit-ms 3600000}))
(assert-false "front-desk-starving?: nil oldest age (no marker yet) never fabricates staleness"
              (operator-lib/front-desk-starving? {:pending-count 2 :oldest-pending-age-ms nil
                                                  :count-limit 5 :age-limit-ms 3600000}))

;; ── BL-345: delivery-based arming ─────────────────────────────────────────
(def retry-cfg {:backoff-base-ms 60000 :backoff-max-ms 1800000 :max-attempts 5})

(assert= "classify-delivery-result: a successful send is :delivered"
         :delivered (operator-lib/classify-delivery-result {:success true :status 200}))
(assert= "classify-delivery-result: no recipient (:disabled) is :terminal-misconfig"
         :terminal-misconfig (operator-lib/classify-delivery-result {:success false :reason :disabled}))
(assert= "classify-delivery-result: missing api key is :terminal-misconfig"
         :terminal-misconfig (operator-lib/classify-delivery-result {:success false :reason :missing-api-key}))
(assert= "classify-delivery-result: test-fixture-suppressed is :terminal-misconfig, never a real failure"
         :terminal-misconfig (operator-lib/classify-delivery-result {:success false :reason :test-fixture-suppressed}))
(assert= "classify-delivery-result: a failed send with NO reason (HTTP non-2xx) is :transient-failure"
         :transient-failure (operator-lib/classify-delivery-result {:success false :status 503}))
(assert= "classify-delivery-result: a failed send with NO reason (exception) is :transient-failure"
         :transient-failure (operator-lib/classify-delivery-result {:success false :error "Connection refused"}))

(assert= "compute-alarm-backoff-ms: attempt 1 is the base"
         60000 (operator-lib/compute-alarm-backoff-ms 1 retry-cfg))
(assert= "compute-alarm-backoff-ms: doubles each attempt"
         240000 (operator-lib/compute-alarm-backoff-ms 3 retry-cfg))
(assert= "compute-alarm-backoff-ms: caps at backoff-max-ms"
         1800000 (operator-lib/compute-alarm-backoff-ms 10 retry-cfg))

(assert-true "starvation-alarm-should-attempt?: fresh starvation (never attempted) attempts immediately"
             (operator-lib/starvation-alarm-should-attempt?
              {:starving? true :armed? false :delivery-attempts 0 :last-attempt-at-ms nil
               :now-ms 100000 :retry-config retry-cfg}))
(assert-false "starvation-alarm-should-attempt?: already armed - never re-attempt (anti-spam)"
              (operator-lib/starvation-alarm-should-attempt?
               {:starving? true :armed? true :delivery-attempts 0 :last-attempt-at-ms nil
                :now-ms 100000 :retry-config retry-cfg}))
(assert-false "starvation-alarm-should-attempt?: no longer starving - never attempt"
              (operator-lib/starvation-alarm-should-attempt?
               {:starving? false :armed? false :delivery-attempts 1 :last-attempt-at-ms 0
                :now-ms 100000 :retry-config retry-cfg}))
(assert-false "starvation-alarm-should-attempt?: a retry before its backoff has elapsed waits"
              (operator-lib/starvation-alarm-should-attempt?
               {:starving? true :armed? false :delivery-attempts 1 :last-attempt-at-ms 100000
                :now-ms 130000 :retry-config retry-cfg}))
(assert-true "starvation-alarm-should-attempt?: a retry once its backoff has elapsed is due"
             (operator-lib/starvation-alarm-should-attempt?
              {:starving? true :armed? false :delivery-attempts 1 :last-attempt-at-ms 100000
               :now-ms 160000 :retry-config retry-cfg}))

(assert= "next-starvation-alarm-state: :delivered arms and resets attempts"
         {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil :gave-up? false}
         (operator-lib/next-starvation-alarm-state :delivered {:delivery-attempts 2} retry-cfg 200000))
(assert= "next-starvation-alarm-state: :terminal-misconfig arms without retrying"
         {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil :gave-up? false}
         (operator-lib/next-starvation-alarm-state :terminal-misconfig {:delivery-attempts 0} retry-cfg 200000))
(assert= "next-starvation-alarm-state: :transient-failure under the cap stays UNARMED and counts the attempt"
         {:armed? false :delivery-attempts 1 :last-attempt-at-ms 200000 :gave-up? false}
         (operator-lib/next-starvation-alarm-state :transient-failure {:delivery-attempts 0} retry-cfg 200000))
(assert= "next-starvation-alarm-state: :transient-failure AT the cap arms anyway and gives up loudly"
         {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil :gave-up? true}
         (operator-lib/next-starvation-alarm-state :transient-failure {:delivery-attempts 4} retry-cfg 200000))

;; ── resolve-provider-state (pure) — BL-305 fail-open cooldown ────────────
;; A fixed instant, never the real clock (de0991e). now = 6pm local (UTC,
;; tz-offset 0) on day 0 = 18*3600000 = 64800000 ms.
(def cfg {:now-ms 64800000 :bounded-fallback-ms 1800000 :plausible-max-ms 21600000})

;; cooldown-resilience-01: a genuine, not-yet-elapsed reset - first-ever
;; detection (no existing record) with a plausible near-term reset.
(assert= "cooldown-resilience-01: a readable, not-yet-elapsed reset genuinely freezes until it"
         {:state :cooldown :reset-ms 71400000 :reset-raw "resets 7:50pm"}
         (operator-lib/resolve-provider-state
          (merge cfg {:limited-text "usage limit reached, resets 7:50pm"
                      :parsed-reset-ms 71400000 ;; 19:50 today, 1h50m ahead - plausible
                      :reset-raw "resets 7:50pm"
                      :existing-reset-ms nil :existing-reset-raw nil})))

;; cooldown-resilience-01 (steady state): an ALREADY-cooling genuine
;; cooldown is authoritative on its OWN reset-ms - a fresh (even
;; identical) live rescan never renews/extends it.
(assert= "an already-cooling genuine cooldown stays on its own reset-ms, ignoring a fresh rescan"
         {:state :cooldown :reset-ms 71400000 :reset-raw "resets 7:50pm"}
         (operator-lib/resolve-provider-state
          (merge cfg {:limited-text "usage limit reached, resets 7:50pm"
                      :parsed-reset-ms 71400000
                      :reset-raw "resets 7:50pm"
                      :existing-reset-ms 71400000 :existing-reset-raw "resets 7:50pm"})))

;; cooldown-resilience-02: no parseable reset at all - bounded fallback,
;; never an unbounded/nil-reset freeze.
(assert= "cooldown-resilience-02: an unparseable reset caps to the bounded fallback window"
         {:state :cooldown :reset-ms (+ 64800000 1800000) :reset-raw "usage limit reached"}
         (operator-lib/resolve-provider-state
          (merge cfg {:limited-text "usage limit reached"
                      :parsed-reset-ms nil
                      :reset-raw "usage limit reached"
                      :existing-reset-ms nil :existing-reset-raw nil})))

;; cooldown-resilience-02 variant / BL-305 QA (d): a resolved reset more
;; than plausible-max-ms ahead is ALSO treated as mis-parsed, not honored
;; as a ~day-long freeze.
(assert= "an implausibly-far-off resolved reset ALSO caps to the bounded fallback window"
         {:state :cooldown :reset-ms (+ 64800000 1800000) :reset-raw "resets 9am"}
         (operator-lib/resolve-provider-state
          (merge cfg {:limited-text "usage limit reached, resets 9am"
                      :parsed-reset-ms (+ 64800000 46800000) ;; ~13h ahead - implausible
                      :reset-raw "resets 9am"
                      :existing-reset-ms nil :existing-reset-raw nil})))

;; cooldown-resilience-03: once the RECORDED reset has passed, resume -
;; even with the old banner still lingering (never re-frozen on stale text
;; alone, no fresh-evidence-free re-entry into cooldown).
(assert= "cooldown-resilience-03: a recorded cooldown whose reset has elapsed resumes, ignoring a lingering stale banner"
         {:state :available}
         (operator-lib/resolve-provider-state
          (merge cfg {:limited-text "usage limit reached, resets 7:50pm"
                      :parsed-reset-ms (+ 64800000 46800000) ;; the SAME stale text re-parsed/rolled to tomorrow - implausible
                      :reset-raw "resets 7:50pm"
                      :existing-reset-ms 60000000 :existing-reset-raw "resets 7:50pm"}))) ;; already in the past (< now-ms)

;; no signal at all, no prior record -> available.
(assert= "no usage-limit signal and no recorded cooldown -> available"
         {:state :available}
         (operator-lib/resolve-provider-state
          (merge cfg {:limited-text nil :parsed-reset-ms nil :reset-raw nil
                      :existing-reset-ms nil :existing-reset-raw nil})))

;; ── BL-306: ask + await a clarifying answer (pure) ───────────────────────

;; resolve-inbound-answer (BL-354 Option C): the three-way decision.
(assert= "answer-pairing-across-threads-01/03: a reply in the awaited thread pairs as the answer"
         {:outcome :pair}
         (operator-lib/resolve-inbound-answer {:question "which env?" :thread-id "SUP-1" :asked-at-ms 1000} "SUP-1"))
(assert= "answer-pairing-across-threads-02: a reply in a DIFFERENT thread re-homes, never pairs - question and asked-at-ms carry over UNCHANGED"
         {:outcome :re-home :question "which env?" :asked-at-ms 1000}
         (operator-lib/resolve-inbound-answer {:question "which env?" :thread-id "SUP-1" :asked-at-ms 1000} "SUP-2"))
(assert= "answer-pairing-across-threads-04: no pending question at all - an ordinary message, nothing attached"
         {:outcome :none}
         (operator-lib/resolve-inbound-answer nil "SUP-1"))

;; BL-466: a re-home carries the pending question's :options along - the
;; poll's discrete options must survive a thread hop unchanged, same as
;; :question/:asked-at-ms already do.
(assert= "BL-466: re-home carries :options through unchanged when the pending question has them"
         {:outcome :re-home :question "which env?" :asked-at-ms 1000 :options ["staging" "prod"]}
         (operator-lib/resolve-inbound-answer
          {:question "which env?" :thread-id "SUP-1" :asked-at-ms 1000 :options ["staging" "prod"]}
          "SUP-2"))

;; BL-466: poll-options - normalizes raw ask options to nil (fall back to a
;; plain message) or a vector of 2+ trimmed, non-blank options (a poll).
(assert= "2 clean options pass through unchanged"
         ["A" "B"]
         (operator-lib/poll-options ["A" "B"]))
(assert= "3 clean options pass through unchanged"
         ["A" "B" "C"]
         (operator-lib/poll-options ["A" "B" "C"]))
(assert= "whitespace is trimmed and blank entries are dropped before counting"
         ["A" "B"]
         (operator-lib/poll-options ["  A  " "" "   " "B"]))
(assert= "exactly 1 option after normalization falls back to nil (plain message, needs 2+)"
         nil
         (operator-lib/poll-options ["A"]))
(assert= "0 options falls back to nil" nil (operator-lib/poll-options []))
(assert= "nil raw options falls back to nil" nil (operator-lib/poll-options nil))

;; BL-483: ask-options - normalizes raw ask options (each a plain string OR
;; a {"label" ... "description" ...} JSON object) to nil (fall back to a
;; plain message) or a vector of {:label :description} maps (tappable
;; buttons). Unlike poll-options, a SINGLE option is usable - buttons carry
;; no Telegram-native "2+ options" constraint the way a poll does.
(assert= "a plain string option normalizes to a label-only map"
         [{:label "staging"}]
         (operator-lib/ask-options ["staging"]))
(assert= "a {label, description} object keeps both fields"
         [{:label "staging" :description "pre-prod"}]
         (operator-lib/ask-options [{"label" "staging" "description" "pre-prod"}]))
(assert= "a {label} object with no description omits the key entirely"
         [{:label "staging"}]
         (operator-lib/ask-options [{"label" "staging"}]))
(assert= "string and object options mix freely in one list"
         [{:label "staging"} {:label "prod" :description "live"}]
         (operator-lib/ask-options ["staging" {"label" "prod" "description" "live"}]))
(assert= "whitespace is trimmed on both label and description"
         [{:label "staging" :description "pre-prod"}]
         (operator-lib/ask-options [{"label" "  staging  " "description" "  pre-prod  "}]))
(assert= "a blank/whitespace-only label is dropped"
         [{:label "prod"}]
         (operator-lib/ask-options ["   " {"label" "prod"}]))
(assert= "a blank/whitespace-only description is omitted, not kept as blank"
         [{:label "staging"}]
         (operator-lib/ask-options [{"label" "staging" "description" "   "}]))
(assert= "a SINGLE usable option is kept (no 2+ minimum, unlike poll-options)"
         [{:label "staging"}]
         (operator-lib/ask-options ["staging"]))
(assert= "0 options falls back to nil" nil (operator-lib/ask-options []))
(assert= "every option blank falls back to nil" nil (operator-lib/ask-options ["" "   "]))
(assert= "nil raw options falls back to nil" nil (operator-lib/ask-options nil))
(assert= "a non-sequential raw value (e.g. a bare number from malformed JSON) falls back to nil, never throws"
         nil
         (operator-lib/ask-options 42))
(assert= "a raw element that is neither a string nor a map (e.g. a number) is dropped, not a crash"
         [{:label "staging"}]
         (operator-lib/ask-options ["staging" 42]))

;; answer-text-from-messages: the human's own latest reply text.
(assert= "the human's latest non-operator message is the answer text"
         "use staging"
         (operator-lib/answer-text-from-messages
          [{:channel "operator" :timestamp "2026-07-12T00:00:00Z" :text "which env?"}
           {:channel "telegram" :timestamp "2026-07-12T00:05:00Z" :text "use staging"}]))
(assert= "picks the LATEST human message, not an earlier one"
         "second reply"
         (operator-lib/answer-text-from-messages
          [{:channel "operator" :timestamp "2026-07-12T00:00:00Z" :text "which env?"}
           {:channel "telegram" :timestamp "2026-07-12T00:05:00Z" :text "first reply"}
           {:channel "telegram" :timestamp "2026-07-12T00:06:00Z" :text "second reply"}]))
(assert= "no non-operator message at all -> nil, never a crash"
         nil
         (operator-lib/answer-text-from-messages [{:channel "operator" :timestamp "2026-07-12T00:00:00Z" :text "which env?"}]))

;; await-timeout-elapsed? / check-awaiting-answer: the bounded
;; escalate-once-then-drop decision.
(assert-true "await-timeout-elapsed? true once now reaches asked-at + timeout" (operator-lib/await-timeout-elapsed? 1000 11000 10000))
(assert-false "await-timeout-elapsed? false before the window elapses" (operator-lib/await-timeout-elapsed? 1000 10999 10000))
(assert-false "await-timeout-elapsed? false with no asked-at at all (nothing to time out)" (operator-lib/await-timeout-elapsed? nil 999999 10000))

(assert= "nothing pending -> no event"
         {:event nil}
         (operator-lib/check-awaiting-answer nil 50000 10000))
(assert= "operator-ask-03: pending but window not yet elapsed -> no event, still waiting"
         {:event nil}
         (operator-lib/check-awaiting-answer {:question "which env?" :thread-id "SUP-1" :asked-at-ms 1000} 10999 10000))
(assert= "operator-ask-03: window elapsed -> escalate AND drop together, exactly once (never a second, later timeout)"
         {:event :escalate-and-drop :question "which env?" :thread-id "SUP-1"}
         (operator-lib/check-awaiting-answer {:question "which env?" :thread-id "SUP-1" :asked-at-ms 1000} 11000 10000))
(assert= "BL-466: check-awaiting-answer is unaffected by a pending question that also carries :options"
         {:event :escalate-and-drop :question "which env?" :thread-id "SUP-1"}
         (operator-lib/check-awaiting-answer
          {:question "which env?" :thread-id "SUP-1" :asked-at-ms 1000 :options ["staging" "prod"]} 11000 10000))

;; ── BL-307: auto-hibernate on drain + mandatory closing pass ─────────────

(assert-true "a paused item with no status is pull-eligible" (operator-lib/paused-item-pull-eligible? {}))
(assert-true "a paused item with status todo is pull-eligible" (operator-lib/paused-item-pull-eligible? {:status "todo"}))
(assert-false "a paused item with status blocked is NOT pull-eligible" (operator-lib/paused-item-pull-eligible? {:status "blocked"}))

(assert-true "backlog-drained? true when active is empty and every paused item is blocked"
             (operator-lib/backlog-drained? 0 [{:status "blocked"}]))
(assert-true "backlog-drained? true when active and paused are both empty"
             (operator-lib/backlog-drained? 0 []))
(assert-false "backlog-drained? false when active has an item"
              (operator-lib/backlog-drained? 1 []))
(assert-false "backlog-drained? false when a paused item is pull-eligible"
              (operator-lib/backlog-drained? 0 [{:status "blocked"} {:status "todo"}]))

(assert-true "role-idle? true with zero inbox and zero in-process"
             (operator-lib/role-idle? {:inbox-new-count 0 :in-process-count 0}))
(assert-false "role-idle? false with a pending inbox item"
              (operator-lib/role-idle? {:inbox-new-count 1 :in-process-count 0}))
(assert-false "role-idle? false with an in-process task"
              (operator-lib/role-idle? {:inbox-new-count 0 :in-process-count 1}))

(assert-true "roster-idle? true when every role is idle"
             (operator-lib/roster-idle? [{:inbox-new-count 0 :in-process-count 0}
                                          {:inbox-new-count 0 :in-process-count 0}]))
(assert-false "roster-idle? false when one role still holds an in-process task"
              (operator-lib/roster-idle? [{:inbox-new-count 0 :in-process-count 0}
                                           {:inbox-new-count 0 :in-process-count 1}]))
(assert-true "roster-idle? vacuously true for an empty roster (a role absent from the roster is trivially quiescent)"
             (operator-lib/roster-idle? []))

(assert-true "should-hibernate? fires on drained backlog + idle roster + not already hibernated"
             (operator-lib/should-hibernate? {:backlog-drained? true :roster-idle? true :already-hibernated? false}))
(assert-false "should-hibernate? never fires while already hibernated"
              (operator-lib/should-hibernate? {:backlog-drained? true :roster-idle? true :already-hibernated? true}))
(assert-false "should-hibernate? does not fire with a non-idle roster"
              (operator-lib/should-hibernate? {:backlog-drained? true :roster-idle? false :already-hibernated? false}))
(assert-false "should-hibernate? does not fire with backlog work remaining"
              (operator-lib/should-hibernate? {:backlog-drained? false :roster-idle? true :already-hibernated? false}))

(assert-true "should-relaunch? fires when hibernated and promotable work arrives"
             (operator-lib/should-relaunch? {:already-hibernated? true :backlog-drained? false}))
(assert-false "should-relaunch? does not fire while not hibernated"
              (operator-lib/should-relaunch? {:already-hibernated? false :backlog-drained? false}))
(assert-false "should-relaunch? does not fire while still drained"
              (operator-lib/should-relaunch? {:already-hibernated? true :backlog-drained? true}))

;; ── BL-318: self-generated provenance + the hibernation quiet-period gate ──

(assert= "format-self-generated-source produces the canonical honest marker"
         "Raised by the coordinator itself (self-generated) - cost review flagged idle quota"
         (operator-lib/format-self-generated-source "cost review flagged idle quota"))

(assert-true "self-generated-item? true for a source carrying the canonical marker"
             (operator-lib/self-generated-item? {:source (operator-lib/format-self-generated-source "reason")}))
(assert-false "self-generated-item? false for an ordinary human-raised source"
              (operator-lib/self-generated-item? {:source "Raised by the human 2026-07-12 via INTAKE-foo.md"}))
(assert-false "self-generated-item? false for an item with no :source at all (conservative default)"
              (operator-lib/self-generated-item? {}))
(assert-false "self-generated-item? false for an Operator-raised source (a real channel, not self-generation)"
              (operator-lib/self-generated-item? {:source "Raised by the Operator 2026-07-12 via INTAKE-bar.md"}))

(assert-true "honest-source? true when a self-generated ticket's source carries the marker"
             (operator-lib/honest-source? (operator-lib/format-self-generated-source "reason") true))
(assert-false "honest-source? false (BL-314's own bug): actually self-generated but source claims human origin"
              (operator-lib/honest-source? "Raised by the human 2026-07-12 after reviewing the Cost & Health panel" true))
(assert-true "honest-source? true for a genuinely human-raised ticket claiming human origin"
             (operator-lib/honest-source? "Raised by the human 2026-07-12 via INTAKE-foo.md" false))
(assert-true "honest-source? is vacuously true when the ticket is not actually self-generated, regardless of text"
             (operator-lib/honest-source? "Raised by the human 2026-07-12 via INTAKE-foo.md" false))

(assert-true "paused-item-blocks-hibernation? true for an ordinary pull-eligible, non-self-generated item"
             (operator-lib/paused-item-blocks-hibernation? {:status "todo"}))
(assert-false "paused-item-blocks-hibernation? false for a blocked item (unchanged from paused-item-pull-eligible?)"
              (operator-lib/paused-item-blocks-hibernation? {:status "blocked"}))
(assert-false "paused-item-blocks-hibernation? false for a self-generated item, even if otherwise pull-eligible"
              (operator-lib/paused-item-blocks-hibernation?
               {:status "todo" :source (operator-lib/format-self-generated-source "reason")}))

(assert-true "backlog-drained? true when the only paused item is self-generated (BL-318's own fix)"
             (operator-lib/backlog-drained? 0 [{:status "todo" :source (operator-lib/format-self-generated-source "reason")}]))
(assert-false "backlog-drained? still false when a NON-self-generated paused item is pull-eligible"
              (operator-lib/backlog-drained? 0 [{:status "todo"}]))
(assert-true "backlog-drained? true with a mix of blocked and self-generated paused items, no real pending work"
             (operator-lib/backlog-drained?
              0 [{:status "blocked"} {:status "todo" :source (operator-lib/format-self-generated-source "reason")}]))
(assert-false "backlog-drained? false when a human-raised item sits alongside a self-generated one"
              (operator-lib/backlog-drained?
               0 [{:status "todo" :source "Raised by the human via INTAKE-foo.md"}
                  {:status "todo" :source (operator-lib/format-self-generated-source "reason")}]))

(assert-true "quiet-period-active? true when drained and roster idle"
             (operator-lib/quiet-period-active? {:backlog-drained? true :roster-idle? true}))
(assert-false "quiet-period-active? false when backlog is not drained"
              (operator-lib/quiet-period-active? {:backlog-drained? false :roster-idle? true}))
(assert-false "quiet-period-active? false when the roster is not idle"
              (operator-lib/quiet-period-active? {:backlog-drained? true :roster-idle? false}))

(assert-true "promotion-blocked-by-quiet-period?: a self-generated candidate is blocked during the quiet period"
             (operator-lib/promotion-blocked-by-quiet-period?
              {:source (operator-lib/format-self-generated-source "reason")}
              {:backlog-drained? true :roster-idle? true}))
(assert-false "promotion-blocked-by-quiet-period?: a human-raised candidate is NEVER blocked, even during the quiet period"
              (operator-lib/promotion-blocked-by-quiet-period?
               {:source "Raised by the human via INTAKE-foo.md"}
               {:backlog-drained? true :roster-idle? true}))
(assert-false "promotion-blocked-by-quiet-period?: a self-generated candidate is NOT blocked once real work exists (roster busy)"
              (operator-lib/promotion-blocked-by-quiet-period?
               {:source (operator-lib/format-self-generated-source "reason")}
               {:backlog-drained? true :roster-idle? false}))
(assert-false "promotion-blocked-by-quiet-period?: a self-generated candidate is NOT blocked once active backlog work exists"
              (operator-lib/promotion-blocked-by-quiet-period?
               {:source (operator-lib/format-self-generated-source "reason")}
               {:backlog-drained? false :roster-idle? true}))

;; ── BL-310: seed-race launch grace ────────────────────────────────────────

(assert-true "within-launch-grace? true just after start (age < grace)"
             (operator-lib/within-launch-grace? 0 60000 120000))
(assert-false "within-launch-grace? false once the grace window has elapsed"
              (operator-lib/within-launch-grace? 0 120000 120000))
(assert-false "within-launch-grace? false well past the grace window"
              (operator-lib/within-launch-grace? 0 300000 120000))
(assert-false "within-launch-grace? false when started-at-ms is unknown (nil) - no process lifetime to gate on"
              (operator-lib/within-launch-grace? nil 999999999 120000))

(assert-false "should-hibernate? never fires within the launch grace window, even drained+idle"
              (operator-lib/should-hibernate? {:backlog-drained? true :roster-idle? true
                                                :already-hibernated? false :within-launch-grace? true}))
(assert-true "should-hibernate? fires once the grace window has elapsed (drained+idle as before)"
             (operator-lib/should-hibernate? {:backlog-drained? true :roster-idle? true
                                               :already-hibernated? false :within-launch-grace? false}))

(assert-true "should-relaunch? fires on fresh coordinator mail alone, with no promotable backlog work"
             (operator-lib/should-relaunch? {:already-hibernated? true :backlog-drained? true
                                              :fresh-coordinator-mail? true}))
(assert-false "should-relaunch? does not fire with neither fresh mail nor promotable work"
              (operator-lib/should-relaunch? {:already-hibernated? true :backlog-drained? true
                                               :fresh-coordinator-mail? false}))

;; hibernate-swarm!/relaunch-swarm! — adapter-injected, spied via an atom.
(let [calls (atom [])
      adapters {:backup-roster! (fn [] (swap! calls conj :backup-roster))
                :empty-roster! (fn [] (swap! calls conj :empty-roster))
                :kill-swarm-tmux! (fn [] (swap! calls conj :kill-swarm-tmux))
                :write-hibernation-state! (fn [ms] (swap! calls conj [:write-hibernation-state ms]))}
      result (operator-lib/hibernate-swarm! 5000 adapters)]
  (assert= "hibernate-swarm! invokes backup, empty, kill, write-state in order"
           [:backup-roster :empty-roster :kill-swarm-tmux [:write-hibernation-state 5000]]
           @calls)
  (assert= "hibernate-swarm! returns hibernated? true with the given timestamp"
           {:hibernated? true :at-ms 5000} result))

(let [calls (atom [])
      adapters {:restore-roster! (fn [] (swap! calls conj :restore-roster))
                :relaunch-tmux! (fn [] (swap! calls conj :relaunch-tmux))
                :clear-hibernation-state! (fn [] (swap! calls conj :clear-hibernation-state))}
      result (operator-lib/relaunch-swarm! 9000 adapters)]
  (assert= "relaunch-swarm! invokes restore, relaunch, clear-state in order"
           [:restore-roster :relaunch-tmux :clear-hibernation-state]
           @calls)
  (assert= "relaunch-swarm! returns relaunched? true with the given timestamp"
           {:relaunched? true :at-ms 9000} result))

;; evaluate-closing-pass! — the full tick-level dispatch; asserts EXACTLY
;; which adapters ran for each trigger, and that a normal in-flight tick
;; touches none of them at all.
(let [calls (atom [])
      adapters {:backup-roster! (fn [] (swap! calls conj :backup-roster))
                :empty-roster! (fn [] (swap! calls conj :empty-roster))
                :kill-swarm-tmux! (fn [] (swap! calls conj :kill-swarm-tmux))
                :write-hibernation-state! (fn [_] (swap! calls conj :write-hibernation-state))
                :restore-roster! (fn [] (swap! calls conj :restore-roster))
                :relaunch-tmux! (fn [] (swap! calls conj :relaunch-tmux))
                :clear-hibernation-state! (fn [] (swap! calls conj :clear-hibernation-state))}]
  (let [result (operator-lib/evaluate-closing-pass!
                {:backlog-drained? true :roster-idle? true :already-hibernated? false :now-ms 1}
                adapters)]
    (assert= "evaluate-closing-pass! hibernates on a drained+idle tick" :hibernated (:action result))
    (assert= "evaluate-closing-pass! invoked only the hibernate-side adapters"
             [:backup-roster :empty-roster :kill-swarm-tmux :write-hibernation-state] @calls))
  (reset! calls [])
  (let [result (operator-lib/evaluate-closing-pass!
                {:backlog-drained? false :roster-idle? true :already-hibernated? true :now-ms 2}
                adapters)]
    (assert= "evaluate-closing-pass! relaunches once new work arrives while hibernated" :relaunched (:action result))
    (assert= "evaluate-closing-pass! invoked only the relaunch-side adapters"
             [:restore-roster :relaunch-tmux :clear-hibernation-state] @calls))
  (reset! calls [])
  (let [result (operator-lib/evaluate-closing-pass!
                {:backlog-drained? false :roster-idle? true :already-hibernated? false :now-ms 3}
                adapters)]
    (assert= "evaluate-closing-pass! does nothing on a normal in-flight tick" nil (:action result))
    (assert= "evaluate-closing-pass! touched no adapter at all when neither trigger fires" [] @calls))

  ;; BL-310 swarm-seed-race-01: within grace, drained+idle -> does not hibernate
  (reset! calls [])
  (let [result (operator-lib/evaluate-closing-pass!
                {:backlog-drained? true :roster-idle? true :already-hibernated? false :now-ms 4
                 :within-launch-grace? true}
                adapters)]
    (assert= "BL-310-01: never hibernates within the launch grace window" nil (:action result))
    (assert= "BL-310-01: touched no adapter at all" [] @calls))

  ;; BL-310 swarm-seed-race-02: grace elapsed, drained+idle -> hibernates as before
  (reset! calls [])
  (let [result (operator-lib/evaluate-closing-pass!
                {:backlog-drained? true :roster-idle? true :already-hibernated? false :now-ms 5
                 :within-launch-grace? false}
                adapters)]
    (assert= "BL-310-02: hibernates once the grace window has elapsed" :hibernated (:action result))
    (assert= "BL-310-02: invoked only the hibernate-side adapters"
             [:backup-roster :empty-roster :kill-swarm-tmux :write-hibernation-state] @calls))

  ;; BL-310 swarm-seed-race-03: hibernated, no promotable work, fresh mail -> relaunches
  (reset! calls [])
  (let [result (operator-lib/evaluate-closing-pass!
                {:backlog-drained? true :roster-idle? true :already-hibernated? true :now-ms 6
                 :fresh-coordinator-mail? true}
                adapters)]
    (assert= "BL-310-03: fresh coordinator mail wakes a hibernated swarm with no promotable ticket yet"
             :relaunched (:action result))
    (assert= "BL-310-03: invoked only the relaunch-side adapters"
             [:restore-roster :relaunch-tmux :clear-hibernation-state] @calls))

  ;; BL-310 swarm-seed-race-04: hibernated, no promotable work, no fresh mail -> stays hibernated
  (reset! calls [])
  (let [result (operator-lib/evaluate-closing-pass!
                {:backlog-drained? true :roster-idle? true :already-hibernated? true :now-ms 7
                 :fresh-coordinator-mail? false}
                adapters)]
    (assert= "BL-310-04: stays hibernated with no fresh mail and no promotable work" nil (:action result))
    (assert= "BL-310-04: touched no adapter at all" [] @calls)))

;; ── BL-334: the restricted front-desk Operator's launch gate ──────────────
;; should-launch-front-desk-operator? and should-launch-operator? are read
;; from the SAME full-operator-running?/llm-running? fact within one tick
;; (operator_runtime.bb's tick! passes its own single llm-running? local to
;; both) - they are literal negations of each other on that one input, which
;; is the structural, provable reason the two Operators can never both claim
;; the same pending queue in the same tick (restricted-front-desk-operator-06).

(assert-true "front-desk launches when the full Operator holds the slot and a message is pending"
             (operator-lib/should-launch-front-desk-operator?
              {:full-operator-running? true :front-desk-running? false
               :provider-state :available :pending-count 1}))
(assert-false "front-desk does not launch when the full Operator is NOT running (normal path handles it)"
              (operator-lib/should-launch-front-desk-operator?
               {:full-operator-running? false :front-desk-running? false
                :provider-state :available :pending-count 1}))
(assert-false "front-desk never double-launches while its own prior run is still in flight"
              (operator-lib/should-launch-front-desk-operator?
               {:full-operator-running? true :front-desk-running? true
                :provider-state :available :pending-count 1}))
(assert-false "front-desk does not launch with nothing pending"
              (operator-lib/should-launch-front-desk-operator?
               {:full-operator-running? true :front-desk-running? false
                :provider-state :available :pending-count 0}))
(assert-false "front-desk respects provider cooldown, same as the full Operator"
              (operator-lib/should-launch-front-desk-operator?
               {:full-operator-running? true :front-desk-running? false
                :provider-state :cooldown :pending-count 1}))

;; restricted-front-desk-operator-05/06: mutual exclusivity, proven for every
;; combination of the shared full-operator-running? fact.
(doseq [running? [true false]
        pending [0 1 5]]
  (let [full (operator-lib/should-launch-operator?
              {:llm-running? running? :provider-state :available :pending-count pending})
        front (operator-lib/should-launch-front-desk-operator?
               {:full-operator-running? running? :front-desk-running? false
                :provider-state :available :pending-count pending})]
    (assert-false (str "restricted-front-desk-operator-06: full+front-desk never both eligible "
                        "(running?=" running? " pending=" pending ")")
                  (and full front))))

;; ── BL-334: the reply text extracted from the restricted Operator's
;;    headless `claude -p --output-format json` result - the ONLY channel it
;;    has to communicate anything, since it holds no tool at all ───────────
(assert= "front-desk-reply-text: a successful result's text is the reply"
         "The Operator will get back to you shortly."
         (operator-lib/front-desk-reply-text
          {:is_error false :result "The Operator will get back to you shortly."}))
(assert= "front-desk-reply-text: an errored result has no reply"
         nil (operator-lib/front-desk-reply-text {:is_error true :result "boom"}))
(assert= "front-desk-reply-text: a blank result has no reply"
         nil (operator-lib/front-desk-reply-text {:is_error false :result "  "}))
(assert= "front-desk-reply-text: no result at all has no reply"
         nil (operator-lib/front-desk-reply-text {:is_error false}))

;; ── BL-334: the self-contained prompt text for the restricted Operator -
;;    it has no Read tool, so everything it needs must be inlined here ─────
(let [prompt (operator-lib/front-desk-reply-prompt
              {:transcript {:id "SUP-1" :messages [{:channel "telegram" :text "when will BL-1 ship?"}]}
               :long-term-memory ["the human prefers terse replies"]})]
  (assert-true "front-desk-reply-prompt: carries the thread's own message text"
               (clojure.string/includes? prompt "when will BL-1 ship?"))
  (assert-true "front-desk-reply-prompt: carries the long-term memory facts"
               (clojure.string/includes? prompt "the human prefers terse replies"))
  (assert-true "front-desk-reply-prompt: tells it plainly it holds no tool/swarm authority"
               (clojure.string/includes? prompt "NO tool"))
  (assert-true "front-desk-reply-prompt: defaults to the normal verbosity directive when no verbosity is given"
               (clojure.string/includes? prompt "Be normal in your responses")))

;; ── BL-383: resolve-front-desk-verbosity - reads the target's agreed
;;    verbosity off its RAW contract.yaml text, never a level BL-382 would
;;    reject ──────────────────────────────────────────────────────────────
(assert= "resolve-front-desk-verbosity: reads a present, known value"
         "concise"
         (operator-lib/resolve-front-desk-verbosity "scope: []\nverbosity: concise\nagreement: agreed\n"))
(assert= "resolve-front-desk-verbosity: reads the detailed level"
         "detailed"
         (operator-lib/resolve-front-desk-verbosity "verbosity: detailed\n"))
(assert= "resolve-front-desk-verbosity: an absent field defaults to normal"
         "normal"
         (operator-lib/resolve-front-desk-verbosity "scope: []\nagreement: agreed\n"))
(assert= "resolve-front-desk-verbosity: nil content (no contract.yaml at all) defaults to normal"
         "normal"
         (operator-lib/resolve-front-desk-verbosity nil))
(assert= "resolve-front-desk-verbosity: an unrecognized value defaults to normal, never passed through"
         "normal"
         (operator-lib/resolve-front-desk-verbosity "verbosity: extremely chatty\n"))

;; ── BL-383: front-desk-reply-prompt's own verbosity directive, per level ──
(doseq [level ["concise" "normal" "detailed"]]
  (let [prompt (operator-lib/front-desk-reply-prompt
                {:transcript {:id "SUP-1" :messages []} :long-term-memory [] :verbosity level})]
    (assert-true (str "front-desk-reply-prompt: carries the " level " style directive")
                 (clojure.string/includes? prompt (str "Be " level " in your responses")))))

;; ── BL-383: compose-front-desk-reply-prompt - the ONE seam both the real
;;    launch and this feature's acceptance steps call, so it must resolve
;;    verbosity from the RAW contract.yaml content itself, never a
;;    pre-resolved value ───────────────────────────────────────────────────
(let [prompt (operator-lib/compose-front-desk-reply-prompt
              {:contract-yaml-content "verbosity: concise\nagreement: agreed\n"
               :transcript {:id "SUP-1" :messages [{:channel "telegram" :text "status?"}]}
               :long-term-memory []})]
  (assert-true "compose-front-desk-reply-prompt: reflects the contract's own concise verbosity"
               (clojure.string/includes? prompt "Be concise in your responses"))
  (assert-true "compose-front-desk-reply-prompt: still carries the transcript"
               (clojure.string/includes? prompt "status?")))

(let [prompt (operator-lib/compose-front-desk-reply-prompt
              {:contract-yaml-content nil :transcript {:id "SUP-1" :messages []} :long-term-memory []})]
  (assert-true "compose-front-desk-reply-prompt: a target with no contract.yaml at all defaults to normal, never crashes"
               (clojure.string/includes? prompt "Be normal in your responses")))

;; BL-383 scenario 03 (restart-free): two composes in a row with DIFFERENT
;; raw contract content produce DIFFERENT directives - nothing here is
;; cached across calls, which is what makes the live wiring's "re-read on
;; every wake" restart-free by construction rather than by accident.
(let [first-prompt (operator-lib/compose-front-desk-reply-prompt
                     {:contract-yaml-content "verbosity: detailed\n" :transcript {} :long-term-memory []})
      second-prompt (operator-lib/compose-front-desk-reply-prompt
                     {:contract-yaml-content "verbosity: concise\n" :transcript {} :long-term-memory []})]
  (assert-true "compose-front-desk-reply-prompt: first call reflects detailed"
               (clojure.string/includes? first-prompt "Be detailed in your responses"))
  (assert-true "compose-front-desk-reply-prompt: very next call reflects concise, no restart needed"
               (clojure.string/includes? second-prompt "Be concise in your responses")))

;; ── BL-334: the front-desk Operator's status is reported ALONGSIDE the
;;    full Operator's, never overwriting it - render-status stays UNCHANGED
;;    (restricted-front-desk-operator-07's own "neither has overwritten the
;;    other" is a property of the SINGLE atomic write in operator_runtime.bb
;;    nesting both under one map, proven here at the schema level) ─────────
(assert= "render-front-desk-status matches the restricted schema"
         {:llm_running true :pending_events 2}
         (operator-lib/render-front-desk-status {:llm-running? true :pending-count 2}))
(assert= "render-front-desk-status defaults to idle/zero"
         {:llm_running false :pending_events 0}
         (operator-lib/render-front-desk-status {}))

;; ── BL-371: question-intake-slug/question-intake-content (pure) ─────────

(assert= "question-intake-slug is stable and filename-safe"
         "operator-question-1000" (operator-lib/question-intake-slug 1000))

(let [content (operator-lib/question-intake-content "why is X broken?" "2026-07-14T00:00:00Z")]
  (assert-true "question-intake-content carries the question text verbatim"
               (clojure.string/includes? content "why is X broken?"))
  (assert-true "question-intake-content carries the filing timestamp"
               (clojure.string/includes? content "2026-07-14T00:00:00Z"))
  (assert-true "question-intake-content marks itself a PROPOSAL, never a spec the Operator authored"
               (clojure.string/includes? content "RAW"))
  (assert-false "question-intake-content never fabricates acceptance criteria"
                (clojure.string/includes? content "acceptance:")))

;; ── BL-415: github-base-from-remote-url/github-permalink/
;;    filed-intake-confirmation-text (pure) ──────────────────────────────

(assert= "SSH remote form normalizes to the https github base, .git stripped"
         "https://github.com/ldecorps/swarmforgevc"
         (operator-lib/github-base-from-remote-url "git@github.com:ldecorps/swarmforgevc.git"))
(assert= "HTTPS remote form normalizes the same way"
         "https://github.com/ldecorps/swarmforgevc"
         (operator-lib/github-base-from-remote-url "https://github.com/ldecorps/swarmforgevc.git"))
(assert= "a non-GitHub remote yields no base"
         nil (operator-lib/github-base-from-remote-url "git@gitlab.com:ldecorps/swarmforgevc.git"))
(assert= "a blank/missing remote yields no base" nil (operator-lib/github-base-from-remote-url nil))
(assert= "an empty-string remote yields no base" nil (operator-lib/github-base-from-remote-url ""))

(assert= "github-permalink composes blob/<sha>/<rel-path> off a real base"
         "https://github.com/ldecorps/swarmforgevc/blob/abc123/backlog/INTAKE-x.md"
         (operator-lib/github-permalink "https://github.com/ldecorps/swarmforgevc" "abc123" "backlog/INTAKE-x.md"))
(assert= "github-permalink is nil when there is no base to link against"
         nil (operator-lib/github-permalink nil "abc123" "backlog/INTAKE-x.md"))

(assert= "filed-intake-confirmation-text carries a commit-sha permalink for a GitHub origin"
         "Filed for the swarm: backlog/INTAKE-x.md — https://github.com/ldecorps/swarmforgevc/blob/abc123/backlog/INTAKE-x.md"
         (operator-lib/filed-intake-confirmation-text
          "backlog/INTAKE-x.md" "abc123" "git@github.com:ldecorps/swarmforgevc.git"))
(assert-true "filed-intake-confirmation-text's permalink uses the commit sha, not a mutable branch name"
             (clojure.string/includes?
              (operator-lib/filed-intake-confirmation-text
               "backlog/INTAKE-x.md" "abc123" "git@github.com:ldecorps/swarmforgevc.git")
              "/blob/abc123/"))
(assert= "filed-intake-confirmation-text falls back to the plain path for a missing origin"
         "Filed for the swarm: backlog/INTAKE-x.md"
         (operator-lib/filed-intake-confirmation-text "backlog/INTAKE-x.md" "abc123" nil))
(assert= "filed-intake-confirmation-text falls back to the plain path for a non-GitHub origin"
         "Filed for the swarm: backlog/INTAKE-x.md"
         (operator-lib/filed-intake-confirmation-text
          "backlog/INTAKE-x.md" "abc123" "git@gitlab.com:ldecorps/swarmforgevc.git"))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "operator_lib: ALL TESTS PASSED")
  (do (println (str "operator_lib: " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
