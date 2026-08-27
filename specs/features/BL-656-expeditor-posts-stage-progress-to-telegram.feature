Feature: expeditor posts stage progress to the Telegram Operator topic

  # BL-656: headless expedite stages cannot carry remote-control; the phone-visible
  # ride log posts one compact line per milestone to the standing Operator topic
  # (BL-346). Fire-and-forget — announcer failure never fails the expedition.
  # Operator 2026-07-26: "ok oui fais ça".

  Background:
    Given a fixture project root with expedite announce seam enabled
    And EXPEDITE_ANNOUNCE_CMD captures announce lines for acceptance runs

  # BL-656 full-ride-timeline-01
  Scenario: a full expedition posts every milestone so the phone reconstructs the ride
    When an expedite run completes initiation park each stage entry each verdict final verdict and restart
    Then each milestone is announced exactly once to the Operator topic
    And the announced sequence reconstructs the ride without reading the log file

  # BL-656 refuse-survivors-02
  Scenario: a REFUSE posts naming teardown survivors
    Given expedite initiation refuses because teardown is not clean
    When the refuse milestone is announced
    Then the announce line names the BL id and the surviving processes that blocked start

  # BL-656 announcer-failure-nonblocking-03
  Scenario: announcer unavailable does not change expedition outcomes
    Given the default announcer cannot reach Telegram
    When an expedite run completes through final verdict and optional restart
    Then gate outcomes and verdicts match a run with a working announcer
    And a warning is logged that announce delivery failed

  # BL-656 announce-cmd-test-seam-04
  Scenario: EXPEDITE_ANNOUNCE_CMD captures messages without real Telegram
    When an expedite run emits milestones under EXPEDITE_ANNOUNCE_CMD
    Then every milestone line is captured by the announce command
    And no live Telegram API call is required for acceptance

  # BL-656 long-reason-truncates-05
  Scenario: a long bounce reason truncates with an evidence path pointer
    Given a stage verdict carries a reason longer than the note-length discipline
    When the verdict milestone is announced
    Then the posted line truncates the reason
    And the line includes the evidence file path as the pointer to full detail
