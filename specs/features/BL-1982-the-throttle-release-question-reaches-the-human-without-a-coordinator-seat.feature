Feature: BL-1982 The throttle release question reaches the human without a coordinator seat

  Article 3.5 as amended on 2026-10-05: once a throttle episode's signal
  reads normal again, the human is asked ONE question before the cap
  climbs back. Human, 2026-10-05: "Once cap 1 is reached, ask if it is
  safe to release the cap." BL-1981 holds the cap and reports the episode
  awaiting release; until this feature, the coordinator seat raised the
  question by hand. A pack declaring coordinator_mode deterministic has no
  coordinator seat, so nothing would ask and the cap would stay held.

  This feature is the ask, raised by effective_backlog_depth_cli.bb, the
  entry point every promotion decision already calls. It goes to the
  coordinator's own topic through role_ask.bb, once per episode. A tapped
  option is applied on a later run through BL-1981's release CLI. A typed
  reply is kept on the episode for a person to act on. Every scenario runs
  against a fixture root under a temporary directory, never the live
  checkout.

  Background:
    Given a fixture root whose configured active_backlog_max_depth is 6 and whose register crossed the count threshold, after the depth CLI printed 1

  # BL-1982 a-cleared-episode-raises-one-question-01
  Scenario: the run that finds the episode awaiting release raises one question to the coordinator
    Given the register has fallen back under every threshold
    When the depth CLI runs on the fixture root
    Then the coordinator has one pending question naming the red count, how long it has read normal and the cap of 6 a release restores
    And the pending question offers the options "Release the cap" and "Keep the throttle"
    And the throttle recommendation records the question as asked for the open episode

  # BL-1982 a-second-run-asks-nothing-more-02
  Scenario: a later run while the question is pending raises no second question
    Given the register has fallen back under every threshold and the depth CLI raised the throttle question
    When the depth CLI runs on the fixture root
    Then the coordinator's pending question is the throttle question first raised
    And the coordinator outbox holds one throttle question

  # BL-1982 another-pending-question-defers-the-ask-03
  Scenario: another pending coordinator question defers the ask and is left untouched
    Given the register has fallen back under every threshold
    And another coordinator question is pending with a tapped answer recorded for it
    When the depth CLI runs on the fixture root
    Then the coordinator's pending question is the other question, with its answer still unconsumed
    And the throttle recommendation records no question asked for the open episode

  # BL-1982 a-tapped-option-is-applied-04
  Scenario Outline: a tapped option is applied on the next run
    Given the register has fallen back under every threshold and the depth CLI raised the throttle question
    And the human's tapped answer "<option>" is recorded for the coordinator
    When the depth CLI runs on the fixture root
    Then the depth CLI prints <cap>
    And the throttle recommendation reports no episode awaiting release
    And the throttle change log records the answer by "human"

    Examples:
      | option            | cap |
      | Release the cap   | 6   |
      | Keep the throttle | 1   |

  # BL-1982 a-typed-reply-is-kept-not-applied-05
  Scenario: a typed reply keeps the cap held and is kept on the episode
    Given the register has fallen back under every threshold and the depth CLI raised the throttle question
    And the human's typed answer "wait until the reds are under five" is recorded for the coordinator
    When the depth CLI runs on the fixture root
    Then the depth CLI prints 1
    And the throttle recommendation reports the episode awaiting release, carrying the reply "wait until the reds are under five"

  # BL-1982 a-stale-ask-whose-marker-moved-on-is-untouched-06
  Scenario: a stale ask whose marker has moved on to a different question consumes nothing
    Given the register has fallen back under every threshold and the depth CLI raised the throttle question
    And another coordinator question is pending with a tapped answer recorded for it
    When the depth CLI runs on the fixture root
    Then the coordinator's pending question is the other question, with its answer still unconsumed
    And the throttle recommendation reports the episode awaiting release, with no reply recorded
