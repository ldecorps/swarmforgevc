Feature: an expedited run's closing summary names every piece of work it left for someone else

  # BL-1024. The expeditor deliberately does not commit on main and
  # deliberately does not re-promote what it parked - both are recorded in
  # the manual under "What it deliberately does not do". Neither deferral
  # names an owner, and neither reaches the closing summary: move-ticket!
  # uses `git mv`, so the backlog moves end the run STAGED and uncommitted,
  # and the parked tickets sit in backlog/hold/, which Article 3.1 forbids
  # promoting from. The BL-1021 run of 2026-08-21 ended printing
  # "ticket=done restart=failed" and nothing else; backlog/active/ was left
  # empty, three tickets sat unrestored in hold/, four backlog moves sat
  # staged in the shared master checkout, and the pipeline was idle with
  # every mailbox empty until a human noticed. A deferral nobody is told
  # about is not a deferral, it is a drop.

  Background:
    Given an expedited run

  # BL-1024 parked-tickets-are-named-with-their-owner-01
  Scenario: the tickets it parked are named, and so is whoever decides their fate
    Given the run parked other tickets out of active
    When the run prints its closing summary
    Then the closing summary lists "the parked tickets" as outstanding
    And the closing summary names the folder they are held in
    And the closing summary names who must decide whether they return

  # BL-1024 nothing-parked-claims-no-handover-02
  Scenario: a run that parked nothing invents no handover
    Given the run parked no tickets
    When the run prints its closing summary
    Then the closing summary reports that no tickets are held

  # BL-1024 uncommitted-backlog-moves-are-named-03
  Scenario: backlog moves left staged are named as work someone must finish
    Given the run left backlog moves staged and uncommitted
    When the run prints its closing summary
    Then the closing summary lists "the uncommitted backlog moves" as outstanding
    And the closing summary names who must commit them

  # BL-1024 a-dry-run-has-nothing-outstanding-04
  Scenario: a dry run reports nothing outstanding, because it changed nothing
    Given the run was a dry run
    When the run prints its closing summary
    Then the closing summary lists nothing as outstanding

  # BL-1024 an-unhappy-ending-still-reports-its-leavings-05
  Scenario Outline: a run that ended badly still says what it left behind
    Given the run parked other tickets out of active
    And the run ended with <ending>
    When the run prints its closing summary
    Then the closing summary lists "the parked tickets" as outstanding
    And the closing summary lists "the uncommitted backlog moves" as outstanding

    Examples:
      | ending                              |
      | a failed restart                    |
      | a stage that bounced past its bound |
      | a stage that overran its timeout    |
