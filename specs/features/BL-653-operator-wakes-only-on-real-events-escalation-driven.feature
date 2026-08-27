Feature: escalation-driven operator wakes only on real events

  # BL-653: the LLM Operator is summoned; it never patrols. Legitimate wakes:
  # inbound human traffic, deterministic babysitter escalation, SWARM_CONTROL_LOST.
  # Retires per-tick dead-agent-events and payload-free SWARM_CHECK_TIMER LLM wakes.
  # Operator 2026-07-25: "il ne devrait démarrer que s'il y a un message telegram
  # qui est arrivé, ou si le babysitter le réveille, non?"
  # Measured fixture 2026-07-26 night: six stuck parcels WARNed 40+ minutes while
  # the operator woke four times on empty SWARM_CHECK_TIMER — zero artifacts each run.

  Background:
    Given a fixture operator runtime with controllable clocks and stubbed LLM launches

  # BL-653 zero-launches-healthy-night-01
  Scenario: a healthy swarm with no inbound traffic produces zero operator LLM launches overnight
    Given the swarm is healthy with no inbound Telegram traffic
    And the babysitter emits no escalation for the fixture root
    When a full simulated night elapses on the operator runtime tick loop
    Then the operator LLM launch count is zero

  # BL-653 telegram-wakes-once-02
  Scenario: a Telegram topic message wakes exactly one operator run
    Given the swarm is otherwise idle
    When one Telegram topic message arrives for the operator queue
    Then exactly one operator LLM launch occurs
    And that launch carries the inbound message event
    And the reply path to Telegram is unchanged

  # BL-653 babysitter-escalation-wakes-once-03
  Scenario: a babysitter escalation wakes one run with finding text while coordinator nudge still works below the bar
    Given the swarm is otherwise idle
    When the babysitter classifies a finding as needs judgement
    Then exactly one operator LLM launch occurs
    And the inflight batch contains the babysitter finding text
  Scenario: a babysitter finding below the escalation bar still nudges the coordinator only
    Given the swarm is otherwise idle
    When the babysitter classifies a finding below the escalation bar
    Then no operator LLM launch occurs
    And the coordinator pane receives a nudge

  # BL-653 real-death-vs-dormant-04
  Scenario: a real resident death reaches the operator via babysitter escalation within one sweep period
    Given a mono-router rotation pack with one live resident role
    When the active resident process is killed
    Then the babysitter escalates within one sweep period
    And exactly one operator LLM launch carries the escalation
  Scenario: a dormant rotation-pack role never escalates as dead
    Given a mono-router rotation pack with dormant roles by design
    When the dormant roles have no live tmux session
    Then no babysitter escalation names those dormant roles as dead
    And no operator LLM launch occurs for agent exit fabrication

  # BL-653 swarm-control-lost-direct-05
  Scenario: SWARM_CONTROL_LOST still wakes the operator directly
    Given the swarm control plane is lost for the fixture root
    When the operator runtime tick runs
    Then exactly one operator LLM launch occurs for SWARM_CONTROL_LOST
    And no fabricated AGENT_EXITED events accompany that wake

  # BL-653 front-desk-restricted-byte-identical-06
  Scenario: the front-desk restricted operator lifecycle stays byte-identical
    Given the front-desk restricted operator path from BL-334
    When this ticket's wake-model changes land on main
    Then the restricted operator lifecycle and wake sources are unchanged from BL-334

  # BL-653 night-start-pid-hold-retired-07
  Scenario: night-start pid-hold is removed and unattended night cost tracks real events only
    Given BL-653 wake-model changes are landed
    When night-start.sh is inspected for the fixture root
    Then the conditional operator pid-hold block is absent
    And an unattended simulated night with only real events produces operator cost proportional to those events
