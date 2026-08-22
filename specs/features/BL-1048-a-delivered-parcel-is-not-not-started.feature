Feature: A delivered parcel is not not-started

  The board's stage scan reads each role's opened mail and nothing else, so a
  parcel that has been routed, delivered and woken - but not yet picked up -
  names its ticket in a file no scan opens. The ticket renders in the
  not-started column, indistinguishable from one no role has ever been given.

  That is the one state Article 2.4 puts a ten-minute clock on, and the board
  is the surface the chase is meant to be spotted from.

  The not-started column means no role has the parcel. It does not mean no
  role has opened it.

  Background:
    Given a pipeline board rendered from the roles' mailboxes

  # BL-1048 a-delivered-parcel-is-not-not-started-01
  Scenario Outline: a routed parcel names its role whatever state it is in
    Given a ticket's parcel is <parcel state> at a role
    When the board is rendered
    Then that ticket's row names that role
    And the not-started column does not name it

    Examples:
      | parcel state           |
      | delivered but unopened |
      | opened                 |

  # BL-1048 a-delivered-parcel-is-not-not-started-02
  Scenario: a ticket with no parcel anywhere is still not-started
    Given an active ticket has no parcel at any role
    When the board is rendered
    Then the not-started column names that ticket

  # BL-1048 a-delivered-parcel-is-not-not-started-03
  Scenario: a ticket delivered downstream while still open upstream resolves to one role
    Given a ticket's parcel is opened at a role
    And that ticket's parcel is delivered but unopened at a later role
    When the board is rendered
    Then that ticket's row names the later role
    And no other column names that ticket

  # BL-1048 a-delivered-parcel-is-not-not-started-04
  Scenario: a delivered note names its ticket the same way a delivered handoff does
    Given a ticket is named only by a delivered but unopened note at a role
    When the board is rendered
    Then that ticket's row names that role

  # BL-1048 a-delivered-parcel-is-not-not-started-05
  Scenario: a delivered parcel naming a closed ticket puts nothing on the board
    Given a ticket's parcel is delivered but unopened at a role
    And that ticket is no longer active
    When the board is rendered
    Then no row names that ticket
