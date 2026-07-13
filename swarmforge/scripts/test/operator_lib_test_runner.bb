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

;; resolve-pending-answer: unambiguous MVP pairing - the SAME thread.
(assert-true "operator-ask-02: a reply in the awaited thread resolves the pending question"
             (operator-lib/resolve-pending-answer {:question "which env?" :thread-id "SUP-1" :asked-at-ms 1000} "SUP-1"))
(assert-false "a reply in a DIFFERENT thread does not resolve an unrelated pending question"
              (operator-lib/resolve-pending-answer {:question "which env?" :thread-id "SUP-1" :asked-at-ms 1000} "SUP-2"))
(assert-false "no pending question at all - nothing to resolve"
              (operator-lib/resolve-pending-answer nil "SUP-1"))

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
               (clojure.string/includes? prompt "NO tool")))

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

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "operator_lib: ALL TESTS PASSED")
  (do (println (str "operator_lib: " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
