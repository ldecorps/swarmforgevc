Feature: the operator LLM wakes only on inbound human traffic or deterministic escalation

  # BL-653: the operator runtime currently manufactures liveness pseudo-events every
  # tick (dead-agent-events, payload-free SWARM_CHECK_TIMER), burning hundreds of
  # pointless Opus launches on healthy nights. The target model: summoned, never
  # scheduled — legitimate wakes are inbound human messages, babysitter escalations,
  # and SWARM_CONTROL_LOST. BL-647 fixed the liveness producer; this ticket retires
  # the per-tick wake sources and wires BABYSITTER_ESCALATION from the deterministic
  # babysitter (BL-611, landed). Invariant: the patrol wake is never removed before
  # a live escalation producer exists.

  Background:
    Given the swarm is healthy with no inbound human traffic
    And the babysitter reports no escalation-worthy findings

  # BL-653 healthy-night-zero-launches-01
  Scenario: a full simulated night with no real events launches the operator LLM zero times
    When the operator runtime runs through a full simulated unattended night
    Then the operator LLM launch count is exactly zero
    And no payload-free SWARM_CHECK_TIMER event is enqueued

  # BL-653 telegram-message-wakes-one-run-02
  Scenario: an inbound Telegram topic message wakes exactly one operator run carrying that event
    When a TELEGRAM_TOPIC_MESSAGE arrives for a backlog topic
    And the operator runtime processes the queue
    Then exactly one operator LLM run is launched
    And that run's inflight batch contains the topic message event

  # BL-653 babysitter-escalation-wakes-one-run-03
  Scenario: a babysitter escalation wakes exactly one operator run whose batch carries the finding text
    When the babysitter enqueues a BABYSITTER_ESCALATION with finding text
    And the operator runtime processes the queue
    Then exactly one operator LLM run is launched
    And that run's inflight batch contains the finding text

  # BL-653 coordinator-nudge-below-bar-04
  Scenario: a babysitter finding below the escalation bar nudges the coordinator without waking the operator
    When the babysitter classifies a finding as below the escalation bar
    Then the coordinator pane receives a nudge
    And the operator LLM launch count is unchanged

  # BL-653 real-death-escalates-dormant-never-05
  Scenario Outline: a real resident death reaches the operator via babysitter escalation but a dormant rotation role never does
    Given the pack is a rotation router with active role <active role>
    And <death condition>
    When the babysitter completes one sweep period
    Then <operator outcome>

    Examples:
      | active role | death condition                             | operator outcome                                                          |
      | coder       | the active resident process is killed         | exactly one BABYSITTER_ESCALATION reaches the operator within one sweep |
      | architect   | a dormant rotation role has no live session | the operator LLM launch count is unchanged                                |

  # BL-653 swarm-control-lost-direct-wake-06
  Scenario: SWARM_CONTROL_LOST still wakes the operator directly unchanged from BL-368
    When a SWARM_CONTROL_LOST event is enqueued
    And the operator runtime processes the queue
    Then exactly one operator LLM run is launched
    And that run's inflight batch contains the SWARM_CONTROL_LOST event

  # BL-653 front-desk-restricted-operator-unchanged-07
  Scenario: the front-desk restricted operator lifecycle is byte-identical to before this change
    When the front-desk restricted operator bootstrap and tick path are compared to the pre-change baseline
    Then every byte of the restricted-operator lifecycle matches the baseline

  # BL-653 night-start-pid-hold-retired-08
  Scenario: night-start no longer holds the operator pid and unattended cost tracks real events only
    Given this ticket's wake model is landed
    When night-start.sh runs on a healthy swarm with no real events overnight
    Then night-start.sh does not apply an operator pid-hold tourniquet
    And the night's operator LLM launch count equals the count of real inbound or escalation events
