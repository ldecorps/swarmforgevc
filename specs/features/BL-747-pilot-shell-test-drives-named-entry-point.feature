Feature: Pilot land gate refuses shell tests that name an entry-point but never invoke it

  # BL-747: BL-637's lifecycle shell suite claimed to verify stop-swarm.sh
  # refuse-gate behaviour, but sourced stack_survivor_scan.sh and re-derived
  # the branching inline (different success wording; missing kill_rc refuse).
  # BL-746 fixed that remaining work. This ticket hardens /pilot so the same
  # anti-pattern cannot land again: when a run touches a shell test and the
  # ticket names a non-test entry-point script, that script must be invoked
  # in a touched test — not merely sourced via a helper.
  #
  # Same landPilotedTicket owner as BL-729/BL-731/BL-737.

  Background:
    Given a piloted ticket whose declared acceptance contract has just passed

  # BL-747 shell-drive-01
  Scenario: A touched shell test that sources a helper but never invokes the named entry-point refuses the land
    Given the ticket names stop-swarm.sh as an entry-point under test
    And the run's commits touched a shell test that sources stack_survivor_scan.sh
    And that shell test never invokes stop-swarm.sh
    When the pilot runs the landing gate
    Then the land is refused for parallel shell reimplementation
    And the refusal names the entry-point and the test file

  # BL-747 shell-drive-02
  Scenario: Invoking the named entry-point in a touched shell test lets the land complete
    Given the ticket names stop-swarm.sh as an entry-point under test
    And the run's commits touched a shell test that invokes stop-swarm.sh
    When the pilot runs the landing gate
    Then the land is completed

  # BL-747 shell-drive-03
  Scenario: A refused parallel-reimplementation land writes nothing durable
    Given the ticket names stop-swarm.sh as an entry-point under test
    And the run's commits touched a shell test that sources a helper without invoking stop-swarm.sh
    When the pilot runs the landing gate
    Then the land is refused for parallel shell reimplementation
    And the ticket yaml stays where it was
    And no acceptance receipt is written

  # BL-747 shell-drive-04
  Scenario: The check is a no-op when the run touches no shell tests
    Given the ticket names stop-swarm.sh as an entry-point under test
    And the run's commits touched no shell test files
    When the pilot runs the landing gate
    Then the land is completed

  # BL-747 shell-drive-05
  Scenario: The check is a no-op when the ticket names no non-test entry-point script
    Given the ticket names no non-test shell entry-point under test
    And the run's commits touched a shell test that only sources a helper
    When the pilot runs the landing gate
    Then the land is completed

  # BL-747 shell-drive-06
  Scenario: Unreadable ticket or touched-file history lets the land through with a warning
    Given the gate cannot resolve the ticket yaml or which shell tests the run touched
    When the pilot runs the landing gate
    Then the land is completed
    And the outcome warns that shell entry-point drive was not checked
