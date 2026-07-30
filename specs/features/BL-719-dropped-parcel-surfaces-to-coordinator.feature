Feature: A dropped parcel surfaces — an active ticket with no live mail nudges the coordinator

  The BL-222 dispatch-gap sweep answers one question: was this ticket EVER
  dispatched. Any historical trail — a completed parcel, a sent handoff, even a
  note whose message text merely contains the id — marks it dispatched for good.
  So a ticket dispatched once and then dropped mid-pipeline has no detector at
  all: it sits in backlog/active/ indefinitely with nothing to wake it. BL-714
  sat there until QA noticed by eye.

  The nudge goes to the coordinator and nowhere else. Which stage owns a dropped
  parcel, and which commit it should carry, are routing judgements — the
  coordinator's exclusive duty — so this sweep reports and never re-routes.
  Source: BL-714 forensics,
  backlog/evidence/BL-714-parcel-absorbed-into-BL-630-20260730.md.

  Background:
    Given an item in backlog/active/ with an assigned_to
    And the sweep runs on the existing chase cadence

  # BL-719 dropped-parcel-nudge-01
  Scenario: a dispatched ticket with no live mail and a stale trail nudges the coordinator
    Given a handoff trail already mentions the item
    And no parcel for the item sits in any role's new or in_process
    And the item's newest trail event is older than the stall threshold
    When the sweep runs
    Then the coordinator receives a note naming the item as having no parcel in flight
    And the sweep writes no assigned_to, routes nothing, and moves no backlog file

  # BL-719 dropped-parcel-nudge-02
  Scenario Outline: a ticket holding live mail is never nudged, however stale its trail
    Given a handoff trail already mentions the item
    And a parcel for the item sits in a role's <live_state>
    And the item's newest trail event is older than the stall threshold
    When the sweep runs
    Then the sweep sends no nudge for the item

    Examples:
      | live_state |
      | new        |
      | in_process |

  # BL-719 dropped-parcel-nudge-03
  Scenario: a ticket in a normal gap between stages is not nudged
    Given a handoff trail already mentions the item
    And no parcel for the item sits in any role's new or in_process
    And the item's newest trail event is newer than the stall threshold
    When the sweep runs
    Then the sweep sends no nudge for the item

  # BL-719 dropped-parcel-nudge-04
  Scenario: a never-dispatched ticket is left to the dispatch-gap sweep
    Given no handoff trail mentions the item at all
    When the sweep runs
    Then the sweep sends no nudge for the item
    And the dispatch-gap sweep auto-routes the item as it did before

  # BL-719 dropped-parcel-nudge-05
  Scenario: the nudge's own trail does not re-arm the detector
    Given a handoff trail already mentions the item
    And no parcel for the item sits in any role's new or in_process
    And a prior nudge for the item was sent inside the cooldown window
    When the sweep runs
    Then the sweep sends no nudge for the item
