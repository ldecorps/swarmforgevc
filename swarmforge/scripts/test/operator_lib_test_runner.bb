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
          :provider_state "cooldown" :agents_running 8 :pending_events 3}
         (operator-lib/render-status {:state :waiting_for_provider :llm-running? false
                                      :provider "claude" :provider-state :cooldown
                                      :agents-running 8 :pending-count 3}))

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

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "operator_lib: ALL TESTS PASSED")
  (do (println (str "operator_lib: " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
