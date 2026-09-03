Feature: BL-1376 The expedite closing handover names the branch it left unlanded

  An expedite run works on expedite/<BL-id> and never lands it - that is
  deliberate. Its closing OUTSTANDING block exists to name every leaving and
  its owner, and today it names two: the parked tickets and the uncommitted
  backlog moves. The branch is not one of them, so a run can close its ticket
  into backlog/done/ while the code is on no branch anyone reads. This feature
  is that the branch becomes the third named leaving, silent only when there
  is genuinely nothing on it, and that naming it adds no land of any kind.

  # BL-1376 handover-names-the-unlanded-branch-01
  Scenario: the closing handover names the branch, its distance from main, and its owner
    Given an expedite run whose stages have finished
    And the run branch is 3 commits ahead of origin/main
    When the run prints its closing handover
    Then the handover names the run branch as outstanding
    And the handover states the branch is 3 commits ahead of origin/main
    And the handover names the owner who must land it

  # BL-1376 silent-only-when-nothing-to-land-02
  Scenario Outline: the branch is reported unless it genuinely carries nothing
    Given an expedite run whose stages have finished
    And the run branch is <state>
    When the run prints its closing handover
    Then the run branch is <reported> in the handover

    Examples:
      | state                            | reported     |
      | 3 commits ahead of origin/main   | named        |
      | level with origin/main           | not named    |

  # BL-1376 dry-run-reports-nothing-outstanding-03
  Scenario: a dry run still reports nothing outstanding
    Given an expedite run invoked as a dry run, which changed nothing
    When the run prints its closing handover
    Then the handover reports nothing outstanding

  # BL-1376 unreadable-ancestry-reports-rather-than-omits-04
  Scenario: an ancestry check that cannot run reports the branch instead of omitting it
    Given an expedite run whose stages have finished
    And origin/main cannot be resolved
    When the run prints its closing handover
    Then the handover names the run branch as outstanding
    And the handover names the reason the branch distance could not be read

  # BL-1376 refusal-path-reports-the-same-leavings-05
  Scenario: a pre-flight refusal after parking reports the same leavings as the run tail
    Given an expedite run that refuses after it has already parked tickets
    When the run prints its closing handover
    Then the handover names the run branch as outstanding
    And the handover names the parked tickets as outstanding
    And the handover names the uncommitted backlog moves as outstanding

  # BL-1376 naming-is-not-landing-06
  Scenario: naming the branch adds no land, merge, or push to the driver
    Given an expedite run whose stages have finished
    And the run branch is 3 commits ahead of origin/main
    When the run prints its closing handover
    Then origin/main is unchanged by the run
    And the run branch is still the only branch containing the run commits
