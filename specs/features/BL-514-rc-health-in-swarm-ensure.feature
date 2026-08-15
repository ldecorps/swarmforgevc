Feature: BL-514 swarm ensure verifies and repairs remote-control health

  The remote-control health tooling shipped as a standalone operator command,
  so a role whose live agent had silently lost its --remote-control flag
  stayed lost until somebody thought to run that command by hand. Folding a
  remote-control component into the BAU `./swarm ensure` sweep makes the
  check routine. It repairs exactly one state - a live agent that lost its
  flag - and deliberately leaves a dead pane to the agent pane check that
  already respawns crashed panes, so no pane is ever respawned twice in one
  sweep.

  Background:
    Given a fixture swarm whose remote-control probe is substituted by a fake

  # BL-514 rc-health-in-swarm-ensure-01
  Scenario: every configured role gets a remote-control line beside its agent line
    When swarm ensure runs
    Then a remote-control component line is reported for every configured role
    And each role's remote-control line immediately follows that role's own agent pane line

  # BL-514 rc-health-in-swarm-ensure-02
  Scenario Outline: a remote-control state the sweep must not repair reports healthy and respawns nothing
    Given a role whose remote-control state is <state>
    When swarm ensure runs
    Then that role's remote-control component reports HEALTHY
    And the remote-control component respawns no pane for that role

    Examples:
      | state   |
      | healthy |
      | down    |

  # BL-514 rc-health-in-swarm-ensure-03
  Scenario: a live agent that lost its remote-control flag is respawned and reported fixed
    Given a role whose remote-control state is degraded
    And respawning its pane from its launch script restores the flag
    When swarm ensure runs
    Then that role's pane is respawned from its launch script
    And that role's remote-control component reports FIXED

  # BL-514 rc-health-in-swarm-ensure-04
  Scenario: a remote-control repair that does not restore the flag fails without aborting the sweep
    Given a role whose remote-control state is degraded
    And respawning its pane does not restore the flag
    When swarm ensure runs
    Then that role's remote-control component reports FAILED
    And the remaining components are still checked and reported
    And swarm ensure exits non-zero

  # BL-514 rc-health-in-swarm-ensure-05
  Scenario: a role whose launch script declares no remote-control flag is healthy without probing
    Given a role whose launch script declares no remote-control flag
    When swarm ensure runs
    Then that role's remote-control component reports HEALTHY
    And that role's live process is never probed

  # BL-514 rc-health-in-swarm-ensure-06
  Scenario: a rotated mono-router resident is judged against the launch script it is running
    Given a mono-router resident rotated onto a role other than its home role
    And its live agent carries the rotated role's expected remote-control flag
    When swarm ensure runs
    Then the resident's remote-control component reports HEALTHY
    And the resident is not respawned back onto its home role
