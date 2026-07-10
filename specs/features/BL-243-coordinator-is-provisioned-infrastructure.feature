Feature: the coordinator is provisioned infrastructure, not a configured role

  # Baton fleet epic (BL-242) child. Operator ruling 2026-07-10: SPEC THE CHANGE.
  # Reality today: the coordinator is a `window` line in swarmforge.conf (line 54)
  # and ./swarm does not special-case it. Target: the conf declares the PACK ONLY;
  # ./swarm ALWAYS provisions the coordinator, so a conf without a coordinator is
  # the NORMAL launch path. This changes the maintained fork's launch path ->
  # drift-watch review applies. How a swarm is NAMED (no swarm_name field exists
  # today) is part of the deferred swarm-status publish-format decision; the name
  # is a given here. NOTE for human review: scenario 03 ("no integration branch")
  # diverges from the current coordinator, which integrates QA-approved work on
  # main from the shared master checkout — reconcile whether Baton's coordinator
  # keeps or sheds the integration role.

  Background:
    Given a swarm named "second" whose swarmforge.conf declares its pack as role windows
    And ./swarm is the launch entrypoint

  # BL-243 coordinator-infrastructure-01
  Scenario: a conf that omits coordinator still brings a coordinator up
    Given the conf lists all roles except coordinator
    When the swarm launches
    Then every configured role pane comes up with a live agent
    And a coordinator pane is provisioned automatically
    And handoffd delivers local handoffs between roles normally

  # BL-243 coordinator-infrastructure-02
  Scenario: the coordinator is excluded from pack-size counting
    Given the conf declares a 2-pack of coder and cleaner
    When the swarm launches
    Then the reported pack size is 2
    And the coordinator is not counted in the pack size

  # BL-243 coordinator-infrastructure-03
  Scenario: the coordinator owns no branch and no worktree
    When the swarm launches
    Then the coordinator pane has no dedicated git worktree
    And the coordinator writes to no integration branch of its own

  # BL-243 coordinator-infrastructure-04
  Scenario: naming coordinator in the conf is rejected as reserved
    Given the conf lists coordinator among its roles
    When the swarm launches
    Then the launch reports that coordinator is reserved infrastructure
    And the coordinator is provisioned exactly once

  # BL-243 coordinator-infrastructure-05
  Scenario: the coordinator is the swarm's addressable identity
    When the swarm launches
    Then identity() for the swarm returns name "second"
    And the coordinator is the endpoint the fleet console subscribes to
