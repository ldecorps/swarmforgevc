Feature: half-launch and swarm-starved findings queue bounded auto-repair

  # BL-1169 (epic BL-1168): proc-* half-launch and swarm-starved today stop at
  CRIT + operator escalation. Extend BL-1017 repair to half-launch (pane up,
  agent gone) and queue ./swarm ensure when starved streak crosses threshold.
  CRIT remains visible when repair is queued.

  Background:
    Given a standing cursor-forge pack with healthy launch-contract

  # BL-1169 half-launch-queues-ensure-session-01
  Scenario: a half-launch proc CRIT still fires and queues bounded session repair when allowed
    Given role "coder" whose pane exists but no agent process runs under it
    And session repair is allowed for that role
    When the babysitter sweep assesses that role
    Then a CRIT for half-launch is emitted
    And a repair decision to ensure that role session is emitted alongside it

  # BL-1169 starved-streak-queues-ensure-02
  Scenario: a swarm-starved streak above threshold queues control-plane ensure
    Given the swarm has been starved for at least three consecutive sweeps
    And multiple proc findings are present
    When the babysitter sweep assesses swarm starvation
    Then a repair decision to ensure the control plane is emitted
    And operator escalation is not the only recovery path

  # BL-1169 repair-respects-cooldown-03
  Scenario: a role repaired inside the cooldown window is not repaired again
    Given role "specifier" in half-launch state
    And that role was already issued a repair inside the cooldown window
    When the babysitter sweep assesses that role
    Then no new repair decision is emitted
    And the half-launch CRIT is still emitted

  # BL-1169 standing-pack-ensure-regression-04
  Scenario: ensure succeeds on cursor-forge when launch-contract is healthy
    Given the standing pack launch-contract check passes
    When control-plane ensure runs from a starved or half-launch repair decision
    Then ensure completes without launch-contract refusal
    And agent respawn is attempted for affected roles
