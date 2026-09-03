Feature: BL-1379 An expedition's park reverses itself when the expedition lands

  An expedition parks every other active ticket into backlog/hold/ to clear the
  field, and never moves them back. Article 3.1 makes that folder human-held,
  so a mechanical park lands somewhere nothing will ever reverse it and becomes
  indistinguishable from a deliberate human hold. This feature is that the
  driver reverses its own move once the expedition's commit is on main, driven
  by a durable record of what it parked - touching only those tickets, never
  before the land, and never twice.

  Background:
    Given an expedition that parked ticket "BL-9002" out of backlog/active/

  # BL-1379 a-landed-expedition-restores-what-it-parked-01
  Scenario: the tickets an expedition parked come back once its commit is on main
    Given the expedition's approved commit is an ancestor of main
    When the park reversal runs
    Then "BL-9002" is no longer in backlog/hold/
    And the report names "BL-9002" as restored

  # BL-1379 the-restore-destination-re-enters-the-freshness-gate-02
  Scenario: a restored ticket re-enters the queue where the freshness gate will see it
    Given the expedition's approved commit is an ancestor of main
    When the park reversal runs
    Then "BL-9002" is in backlog/paused/

  # BL-1379 nothing-is-restored-before-the-land-03
  Scenario: an expedition that has not landed leaves its park in place and says so
    Given the expedition's approved commit is not an ancestor of main
    When the park reversal runs
    Then "BL-9002" is still in backlog/hold/
    And the closing handover still names "BL-9002" as parked

  # BL-1379 a-human-held-ticket-is-never-touched-04
  Scenario: a ticket a human placed in hold is never moved by the reversal
    Given a ticket "BL-9003" that a human placed in backlog/hold/
    And the expedition's approved commit is an ancestor of main
    When the park reversal runs
    Then "BL-9003" is still in backlog/hold/
    And the report does not name "BL-9003"

  # BL-1379 the-reversal-is-idempotent-05
  Scenario: running the reversal twice changes nothing the second time
    Given the expedition's approved commit is an ancestor of main
    And the park reversal has already run
    When the park reversal runs
    Then the report names nothing as restored
    And "BL-9002" is left exactly where it is

  # BL-1379 a-ticket-that-moved-since-is-left-alone-06
  Scenario Outline: a parked ticket that changed since the park is left where it is
    Given "BL-9002" has since been <change>
    And the expedition's approved commit is an ancestor of main
    When the park reversal runs
    Then "BL-9002" is left exactly where it is
    And the report names "BL-9002" as skipped

    Examples:
      | change                       |
      | moved by hand to backlog/active/ |
      | closed into backlog/done/    |

  # BL-1379 the-park-record-names-each-ticket-and-its-origin-07
  Scenario: the park writes a durable record of what it moved and from where
    When the expedition parks the field
    Then a durable park record names "BL-9002"
    And the record names the folder "BL-9002" was parked from
