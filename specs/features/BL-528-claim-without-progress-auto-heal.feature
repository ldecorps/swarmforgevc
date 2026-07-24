Feature: a claim without progress is auto-healed, and real work is never mistaken for idleness

  A role can hold an in_process task, keep reclaiming it, and sit idle while every
  liveness dashboard stays green — claim/inbox liveness treats "task assigned" as
  healthy. The daemon therefore watches for DURABLE progress on a claim (the role's
  worktree HEAD advancing past the commit it claimed at) and escalates when there is
  none: probe, then nudge, then bounce the claim, then halt the swarm with operator
  alerts.

  The counter-requirement is equally load-bearing: a role that IS working must never
  be counted idle. Reclaim COUNT alone is not evidence of idleness — a busy agent that
  reflexively re-runs ready_for_next.sh between real work steps has a growing diff, and
  halting it destroys real work. Any evidence of activity suppresses the count.

  Background:
    Given a role holding a claimed task in its in_process mailbox

  # BL-528 claim-progress-head-advanced-01
  Scenario: committing on the claim clears the idle signal
    Given the role's worktree HEAD has advanced past the commit it claimed at
    When the claim-progress sweep runs
    Then the claim is treated as "progressing"
    And no idle reclaim is counted against the role

  # BL-528 claim-progress-activity-suppresses-count-02
  Scenario Outline: evidence of activity suppresses idle counting past the timeout
    Given the claim is past its idle timeout with no new commit
    And the role shows activity as "<evidence>"
    When the claim-progress sweep runs
    Then no idle reclaim is counted against the role
    And the swarm is not halted

    Examples:
      | evidence                     |
      | uncommitted work in worktree |
      | agent busy generating        |
      | resident recently active     |

  # BL-528 claim-progress-probe-before-counting-03
  Scenario: the first overdue observation probes the agent instead of counting it idle
    Given the claim is past its idle timeout with no new commit
    And nothing indicates the role is working
    And the role has not been probed about this claim
    When the claim-progress sweep runs
    Then the role is probed once about its idle claim
    And no idle reclaim is counted against the role
    And a further sweep within the probe grace period still counts no idle reclaim

  # BL-528 claim-progress-escalation-ladder-04
  Scenario Outline: the escalation ladder climbs with the idle reclaim count
    Given the escalation thresholds are nudge 1, bounce 6, and halt 10
    And the role has been probed about this claim
    And nothing indicates the role is working
    And the idle reclaim count for this claim has reached <reclaims>
    When the claim-progress sweep runs
    Then the daemon "<action>" the idle claim

    Examples:
      | reclaims | action     |
      | 1        | nudges     |
      | 6        | bounces    |
      | 10       | halts on   |

  # BL-528 claim-progress-halt-alerts-operator-05
  Scenario: a halt tells the operator on both alert channels
    Given the idle reclaim count has reached the halt threshold
    When the daemon halts the swarm for the idle claim
    Then the operator is alerted by Telegram naming the role and reclaim count
    And the operator is emailed about the same halt

  # BL-528 claim-progress-halt-clears-sidecar-06
  Scenario: a halt clears the claim-progress record so a relaunch is not re-halted
    Given the idle reclaim count has reached the halt threshold
    When the daemon halts the swarm for the idle claim
    Then the claim-progress record for that claim is cleared
    And the first sweep after a relaunch does not halt the swarm again

  # BL-528 claim-progress-halt-refused-07
  Scenario Outline: a halt is refused while the swarm is demonstrably alive
    Given the idle reclaim count has reached the halt threshold
    And the swarm state is "<state>"
    When the claim-progress sweep runs
    Then the swarm is not halted
    And the refusal is recorded as telemetry

    Examples:
      | state                                   |
      | the resident agent is working           |
      | a dormant role's claim is stale         |

  # BL-528 claim-progress-role-idle-timeout-08
  Scenario Outline: a role whose work legitimately runs long gets a longer idle timeout
    Given the claim is "<age>" old with no new commit and no evidence of activity
    And the role is "<role>"
    When the claim-progress sweep runs
    Then the claim is treated as "<verdict>"

    Examples:
      | age    | role      | verdict         |
      | 30 min | coder     | overdue         |
      | 30 min | hardender | not yet overdue |
      | 2 h    | hardender | overdue         |
