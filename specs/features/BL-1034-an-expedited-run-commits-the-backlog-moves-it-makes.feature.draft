# BL-1034 - an expedited run commits the backlog moves it makes
#
# Context. `move-ticket!` (expedite_cli.bb) moves backlog tickets with `git mv`,
# which STAGES and nothing more, so before this slice every run ended with `main`
# and the working tree disagreeing about where the moved tickets lived - in a
# checkout every role shares, where the next unrelated commit sweeps them.
# BL-1024 made the run NAME that leaving; this slice makes the run finish it.
#
# Read with docs/reference/BL-567-expeditor-manual.md ("What it deliberately does
# not do") and specs/features/BL-1024-an-expedite-run-names-what-it-leaves-behind
# .feature, whose uncommitted-moves assertions this slice retires.

Feature: an expedited run commits every backlog move it makes, and sweeps nothing else into that commit

  Background:
    Given an expedited run driven through the stage-runner seam in a fixture repo
    And the run's own ticket is in backlog/active/

  # BL-1034 every-move-is-committed-01
  Scenario Outline: each backlog move the run makes is committed by that run
    Given one other ticket is in backlog/active/
    When the run ends
    Then the master checkout has no staged backlog moves
    And the committed backlog holds "<ticket>" in "<folder>"

    Examples:
      | ticket | folder        |
      | other  | backlog/hold/ |
      | own    | backlog/done/ |

  # BL-1034 committed-at-the-moment-of-the-move-02
  Scenario: a run interrupted before its ending has already committed what it moved
    Given one other ticket is in backlog/active/
    And the run has parked the other ticket
    When the run is interrupted before it reaches its ending
    Then the master checkout has no staged backlog moves
    And the committed backlog holds "other" in "backlog/hold/"

  # BL-1034 unhappy-endings-commit-too-03
  Scenario Outline: a run that ends badly still leaves no move staged
    Given one other ticket is in backlog/active/
    And the run will end by <ending>
    When the run ends
    Then the master checkout has no staged backlog moves

    Examples:
      | ending                                              |
      | failing its restart                                 |
      | refusing because the teardown never reached a clean slate |

  # BL-1034 nothing-else-is-swept-in-04
  Scenario: the run's commit carries only the backlog paths it moved
    Given one other ticket is in backlog/active/
    And the master checkout also holds an unrelated staged change and an unrelated unstaged change
    When the run ends
    Then the run's commit touches only paths under backlog/
    And the unrelated staged change is still staged and uncommitted
    And the unrelated unstaged change is still unstaged and unchanged

  # BL-1034 a-dry-run-commits-nothing-05
  Scenario: a dry run commits nothing, because it moved nothing
    Given one other ticket is in backlog/active/
    And the run is a dry run
    When the run ends
    Then the run made no commit
    And the master checkout is as clean as it was before the run

  # BL-1034 no-empty-commit-06
  Scenario: a run with nothing to move makes no commit
    Given the run has nothing to park
    And the run will end by failing before its own ticket moves
    When the run ends
    Then the run made no commit

  # BL-1034 the-summary-reports-the-commit-07
  Scenario: the closing summary reports the commit it made and who must publish it
    Given one other ticket is in backlog/active/
    When the run ends
    Then the closing summary reports the backlog commit it made
    And the closing summary names who must publish that commit
