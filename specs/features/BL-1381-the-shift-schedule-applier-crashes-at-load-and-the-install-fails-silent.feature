Feature: BL-1381 The shift schedule applier loads and its install wrapper fails loud

  shift_schedule_applier_lib.bb requires babashka.process inside a function
  body, so babashka fails to load the file at analysis time. Every consumer
  crashes before doing anything: the reconcile CLI that every swarm start
  runs, the fixture applier, and the BL-660 unit runner that guards this very
  library. The install wrapper around the reconcile CLI can also read an
  empty or unparseable verdict as "no schedule configured" and exit zero.
  This feature is that the library loads again, and that the wrapper reports
  a reconcile that produced nothing as the failure it is.

  Background:
    Given a fixture project root with the swarmforge scripts
    And a crontab shim that reads and writes a fixture crontab file

  # BL-1381 the-applier-library-loads-01
  Scenario: the applier library loads and its unit runner is green
    When the shift schedule applier library is loaded by babashka
    Then loading succeeds
    And the BL-660 unit runner exits zero with no failures

  # BL-1381 a-configured-shift-is-reconciled-02
  Scenario: a configured shift renders its managed block through the live reconcile path
    Given the fixture conf sets swarm_shift to "day"
    And the fixture crontab holds one line that is not the swarm's
    When the schedule cron is installed for the fixture root
    Then the install exits zero reporting the schedule installed
    And the fixture crontab holds the managed block for the fixture root
    And the line that is not the swarm's is still present byte-identical

  # BL-1381 the-governor-verdict-is-best-effort-03
  Scenario Outline: the governor verdict shells out only when its CLI exists
    Given the budget governor CLI is <cli>
    When the budget shift governor verdict is requested for now
    Then the verdict is <verdict>

    Examples:
      | cli                       | verdict          |
      | present and prints a pass | the parsed pass  |
      | absent                    | none             |

  # BL-1381 a-reconcile-that-produced-nothing-is-a-failure-04
  Scenario Outline: a reconcile that produced no verdict fails the install loud
    Given the reconcile step <behaviour>
    When the schedule cron is installed for the fixture root
    Then the install exits non-zero
    And the install output names the reconcile failure
    And the install output does not say no schedule is configured
    And the fixture crontab is byte-identical to before the run

    Examples:
      | behaviour                              |
      | exits non-zero printing nothing        |
      | exits zero printing text that is not JSON |
