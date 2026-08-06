Feature: a live role-held computation that did not run is distinguishable from one that found nothing

  # BL-814: readLiveRoleHeldTickets shells out to the real
  # pipeline_stage_cli.bb. When that subprocess fails — a missing load-file
  # dependency being the observed cause, twice — the failure is swallowed and
  # an empty map is returned, which is exactly what "no role holds a ticket"
  # looks like. The live board then renders confidently blank.
  #
  # The copy-real-scripts fixture in
  # extension/test/readLiveRoleHeldTicketsCli.test.js exists to catch this
  # class. It has now missed it twice (BL-655 added ambulance_lib.bb,
  # BL-805 added mono_router_lib.bb) because a broken fixture produces a
  # passing SHAPE. Scenario 03 is the fix for that; 01 and 02 are the
  # restored behaviour.

  Background:
    Given a fixture tree carrying the real pipeline stage scripts

  # BL-814 role-held-computed-live-01
  Scenario: a role holding a ticket is reported from the live mailbox
    Given the fixture carries every load-file dependency the real scripts need
    And role "coder" holds active ticket "BL-900" in its in_process mailbox
    When the live role-held tickets are read
    Then the result reports "coder" holding "BL-900"

  # BL-814 stale-cache-is-not-consulted-02
  Scenario: a stale cache naming a different role does not affect the answer
    Given the fixture carries every load-file dependency the real scripts need
    And role "coder" holds active ticket "BL-900" in its in_process mailbox
    And a stale ticket-stage-map cache names "specifier" for "BL-900"
    When the live role-held tickets are read
    Then the result reports "coder" holding "BL-900"

  # BL-814 failed-computation-is-loud-03
  Scenario Outline: a computation that could not run is surfaced, never reported as empty
    Given the fixture is missing the load-file dependency <missing-dependency>
    And role "coder" holds active ticket "BL-900" in its in_process mailbox
    When the live role-held tickets are read
    Then the failure is surfaced to the caller
    And the result is not reported as an ordinary empty map

    Examples:
      | missing-dependency  |
      | mono_router_lib.bb  |
      | ambulance_lib.bb    |
      | handoff_lib.bb      |

  # BL-814 genuinely-empty-stays-quiet-04
  Scenario: no role holding a ticket is still an ordinary empty answer
    Given the fixture carries every load-file dependency the real scripts need
    And no role holds an active ticket in its in_process mailbox
    When the live role-held tickets are read
    Then the result is an empty map
    And no failure is surfaced to the caller
