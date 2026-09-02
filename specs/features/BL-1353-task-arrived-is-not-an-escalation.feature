Feature: Ordinary coordinator traffic does not wake the LLM Operator

  BL-653 established that the LLM Operator is summoned, never scheduled, and
  documents exactly three legitimate wake sources: inbound human traffic, a
  babysitter CRIT escalation, and catastrophic control loss. TASK_ARRIVED is
  not among them, yet it is still manufactured every tick from a bare mtime
  probe on the coordinator's inbox - and on 2026-09-02 UTC it produced 37 of
  73 dispatched events, over half of that day's disposable Opus sessions.

  A handoff landing for the coordinator is ordinary pipeline motion the
  coordinator handles itself. It is not a finding that something is odd.

  Two consumers read the same freshness probe and only one of them is in
  scope here: the wake path. The BL-307/BL-310 closing pass also reads it to
  decide whether to hibernate, and that must be left working.

  Background:
    Given the operator runtime tick is running

  # BL-1353 task-arrived-is-not-an-escalation-01
  Scenario: coordinator traffic the coordinator handles itself raises no wake
    Given a handoff landed in the coordinator inbox within the tick interval
    And the coordinator claimed it within its claim window
    When the operator runtime evaluates its tick sweep
    Then no LLM Operator wake event is manufactured

  # BL-1353 task-arrived-is-not-an-escalation-02
  Scenario: the manufactured-source catalogue agrees with the documented model
    When the manufactured tick event types are listed
    Then they are exactly the wake sources the BL-653 model documents

  # BL-1353 task-arrived-is-not-an-escalation-03
  Scenario: the hibernation decision still sees fresh coordinator mail
    Given a handoff landed in the coordinator inbox within the tick interval
    When the closing pass evaluates whether to hibernate
    Then it observes fresh coordinator mail and does not hibernate

  # BL-1353 task-arrived-is-not-an-escalation-04
  Scenario: a babysitter CRIT finding still wakes the Operator
    Given babysitterd has recorded a CRIT finding
    When the operator runtime evaluates its pending queue
    Then an LLM Operator wake event is dispatched
