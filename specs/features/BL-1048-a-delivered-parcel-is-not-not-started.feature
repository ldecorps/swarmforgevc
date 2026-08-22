# mutation-stamp: sha256=ad67b22a441a07e1d72df895a185efe4880b3b643aee5b9ea0980fee8b94a900
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-22T12:56:17.477462917Z","feature_name":"A delivered parcel is not not-started","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1048-a-delivered-parcel-is-not-not-started.feature","background_hash":"e6cbdf7227f142bd28113ba4bdb2ba5a9ae1bf5434b4e66edabdf0338410b8f3","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a routed parcel names its role whatever state it is in","scenario_hash":"4e86aaacb71e2a014d70142740f13e41130d94202d435c9be11f5beff3f0ee66","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-22T12:56:17.477462917Z"}]}
# acceptance-mutation-manifest-end

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
