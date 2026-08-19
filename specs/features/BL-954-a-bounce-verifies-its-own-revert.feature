Feature: A recorded bounce verifies its own revert

  The constitution ("A Bounce Must Be Reverted Out Of The Bouncing Branch",
  BL-490/BL-495) requires the bouncing role to remove the bounced commit's
  content from its own review branch in the same step, confirmed by CONTENT
  and never by ancestry, with one explicit exception: a commit already an
  ancestor of main is reported as a breach instead of reverted.

  Nothing verifies that this happened. This feature makes the bounce
  recording step check its own branch and say what it found, so a skipped
  revert is caught where it happens instead of days later, by hand, after
  the unreviewed content has already ridden onto main.

  Background:
    Given a bouncing role branch and a commit that role has bounced

  # BL-954 bounce-revert-verified-01
  Scenario Outline: the check reports what the bouncing branch actually holds
    Given the bounced commit's content is <content_state> in the bouncing branch
    And the bounced commit is <main_state> an ancestor of main
    When the bounce is recorded and the bounce revert check runs
    Then it reports "<verdict>"
    And the remedy it offers is "<remedy>"
    And the bounce record is present in the durable bounce store

    Examples:
      | content_state | main_state | verdict       | remedy         |
      | live          | not        | violation     | revert-command |
      | reverted      | not        | clean         | none           |
      | live          | already    | breach-report | none           |

  # BL-954 bounce-revert-verified-02
  Scenario: a reverted bounce is still reachable from the bouncing branch and still reads clean
    Given the bounced commit's content is reverted in the bouncing branch
    And the bounced commit is still an ancestor of the bouncing branch
    When the bounce is recorded and the bounce revert check runs
    Then it reports "clean"

  # BL-954 bounce-revert-verified-03
  Scenario Outline: a check it cannot complete names its cause and never reads as clean
    Given the bounce revert check cannot resolve <obstacle>
    When the bounce is recorded and the bounce revert check runs
    Then it reports "undeterminable"
    And it names <obstacle> as the cause
    And the bounce record is present in the durable bounce store

    Examples:
      | obstacle            |
      | the bounced commit  |
      | the bouncing branch |
