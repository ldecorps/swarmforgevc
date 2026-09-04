# mutation-stamp: sha256=e4624fc8d3e1a95092d1d64193a67d7c13149353e4fcfb776b5117f6a4f2cbd3
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-04T12:14:56.884071669Z","feature_name":"BL-1379 An expedition's park reverses itself when the expedition lands","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1379-an-expedite-park-reverses-itself-when-the-expedition-lands.feature","background_hash":"cc80d44da91b185915a2f3159957caf7b7a2b092b49023853bf3d1e686b7922e","implementation_hash":"unknown","scenarios":[{"index":4,"name":"a parked ticket that changed since the park is left where it is","scenario_hash":"433d04e6e15644392445562967a06e7b1894473b6d4321280c2277115042be2a","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-04T12:14:56.884071669Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1379 An expedition's park reverses itself when the expedition lands

  An expedition parks every other active ticket into backlog/hold/ to clear the
  field, and never moves them back. Article 3.1 makes that folder human-held,
  so a mechanical park lands somewhere nothing will ever reverse it and becomes
  indistinguishable from a deliberate human hold. This feature is that the
  driver reverses its own move once the expedition's commit is on main, driven
  by a durable record of what it parked - touching only those tickets, never
  before the land, and never twice. As the human ruled, each restored ticket
  returns to the folder it was parked from, marked as needing a freshness
  check before it may be worked.

  Background:
    Given an expedition that parked ticket "BL-9002" out of backlog/active/

  # BL-1379 a-landed-expedition-restores-what-it-parked-01
  Scenario: the tickets an expedition parked come back once its commit is on main
    Given the expedition's approved commit is an ancestor of main
    When the park reversal runs
    Then "BL-9002" is no longer in backlog/hold/
    And the report names "BL-9002" as restored

  # BL-1379 the-restore-destination-re-enters-the-freshness-gate-02
  # RETIRED 2026-09-04 (never reworded): it encoded ruling option 1 (restore to
  # paused/); the human ruled option 3 on 2026-09-03. Replaced by 08 and 09.

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

  # BL-1379 the-restore-destination-is-the-prior-folder-08
  Scenario: a restored ticket returns to the folder it was parked from
    Given the expedition's approved commit is an ancestor of main
    When the park reversal runs
    Then "BL-9002" is in backlog/active/

  # BL-1379 a-restored-ticket-is-marked-for-a-freshness-check-09
  Scenario: a restored ticket is marked as needing a freshness check before it may be worked
    Given the expedition's approved commit is an ancestor of main
    When the park reversal runs
    Then "BL-9002" reads status blocked
    And "BL-9002" carries freshness_check required naming the expedition
    And the promotion helper skips "BL-9002" as blocked
    And the report names "BL-9002" as restored and marked
