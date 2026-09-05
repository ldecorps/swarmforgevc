# mutation-stamp: sha256=0b16aa7bddbeb8a6d8dbba48957b001781627b34d9a86077a18b28c9d14d9882
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T10:55:36.960654758Z","feature_name":"BL-1414 A repeating freshness violation is announced on its first tick, then digested, never every tick","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1414-a-repeating-freshness-violation-is-announced-once-then-digested.feature","background_hash":"25d7122d0c3f0d9fca153ee416c415fe5e8eb03265cbdb495c25a760a704ef9a","implementation_hash":"unknown","scenarios":[{"index":4,"name":"a different daemon or reason is its own first announce","scenario_hash":"c58dc77644e9feb77dee28efe4d48fca751e08cf3215b8d87a379caafbfd5b24","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-05T10:55:36.960654758Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1414 A repeating freshness violation is announced on its first tick, then digested, never every tick

  The freshness check announces every violation it records, and it records
  one per watched daemon per two-minute tick for as long as the condition
  lasts. On 2026-09-05 the human's Operator topic received four
  FRESHNESS_VIOLATION messages every two minutes for ninety minutes and
  asked: "can something be done to reduce the traffic of this alert, which
  is juat noise as far as I am concerned". That storm had a defect behind
  it (BL-1413), but the announce path would flood the same way on any
  real, persistent violation: a daemon that stays down through a cool-off
  is announced thirty times an hour and the human learns nothing from the
  second message on.

  This feature is that an announce is a transition, not a tick: the first
  tick a (daemon, reason) violates is announced; further ticks of the same
  violation are recorded but not announced until a digest window elapses,
  when one digest names how many ticks were suppressed and the current
  age; and the first tick it is back under threshold announces recovery.
  The durable incident record keeps one line per tick exactly as today.

  Background:
    Given a watched daemon and an announce stub that records every message
    And the digest window is 30 minutes

  # BL-1414 first-violation-is-announced-01
  Scenario: the first tick of a violation is announced
    Given the daemon has been fresh
    When a tick finds it stale
    Then exactly one FRESHNESS_VIOLATION message is announced for it

  # BL-1414 the-same-violation-is-not-re-announced-inside-the-window-02
  Scenario: further ticks of the same violation inside the window are recorded, not announced
    Given the daemon was announced stale on the previous tick
    When 5 more ticks find it stale within the digest window
    Then no further message is announced
    And 5 more incident records are appended

  # BL-1414 one-digest-per-window-03
  Scenario: a violation that outlasts the window gets one digest naming the suppressed count and age
    Given the daemon was announced stale 31 minutes ago and every tick since found it stale
    When a tick finds it stale
    Then exactly one digest message is announced naming the daemon, the number of suppressed ticks and its current age

  # BL-1414 recovery-is-announced-once-04
  Scenario: the first fresh tick after a violation announces recovery once
    Given the daemon was announced stale and is still within the digest window
    When a tick finds it fresh
    Then exactly one recovery message is announced for it
    And a following fresh tick announces nothing

  # BL-1414 suppression-is-keyed-per-daemon-and-reason-05
  Scenario Outline: a different daemon or reason is its own first announce
    Given daemon A was announced stale for reason stale-heartbeat on the previous tick
    When a tick finds <what> in violation
    Then exactly one message is announced for that new violation

    Examples:
      | what                                   |
      | daemon B for reason stale-heartbeat    |
      | daemon A for reason no-heartbeat-line  |
