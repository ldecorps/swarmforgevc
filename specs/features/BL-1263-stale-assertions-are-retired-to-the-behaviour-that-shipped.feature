Feature: BL-1263 three assertions are retired to the behaviour that shipped, and none is weakened on the way

  Three production behaviours changed deliberately and are still correct: a
  bare model id from a launch script is now qualified by the backend that
  will run it, a poll request now carries whether it accepts multiple
  answers, and the ambulance refuses to engage for a ticket that is not
  active. In each case the unit assertion that pinned the previous behaviour
  was never updated, so each has been failing since its change landed.

  A permanently red test is worse than a missing one. It occupies the file a
  real regression would arrive in, and it trains every reader to skip the
  file. What is wanted here is retirement to the current behaviour, which is
  the opposite of deletion: each assertion must still assert the same
  property it was written to assert, over the value that is now correct.

  The temptation in every one of these is to reach for a looser comparison,
  because a substring or a key subset would make all three green in a line.
  That would silently retire the property too. The whole-body comparison in
  particular is the thing that would have caught this in the first place.

  Background:
    Given a source behaviour that changed deliberately and is still correct

  # BL-1263 stale-assertions-are-retired-to-the-behaviour-that-shipped-01
  Scenario Outline: the assertion pins the value that ships now, not the one it replaced
    Given the assertion that expects <retired expectation>
    When the assertion is retired to the shipped behaviour
    Then it expects <shipped behaviour>
    And it passes against the current source

    Examples:
      | retired expectation                    | shipped behaviour                                |
      | an unqualified model id                | the id qualified by its backend                  |
      | a poll body without the multi-answer key | a poll body carrying the multi-answer key      |
      | an ambulance engaged from paused        | an ambulance engaged only from active            |

  # BL-1263 stale-assertions-are-retired-to-the-behaviour-that-shipped-02
  Scenario: the whole-body comparison stays whole, so the next unannounced field is still caught
    Given the poll assertion compares the entire request body
    When an unexpected field is added to that body
    Then the assertion fails

  # BL-1263 stale-assertions-are-retired-to-the-behaviour-that-shipped-03
  Scenario: no assertion is removed and no source behaviour is changed
    When the parcel is reviewed
    Then every assertion that was red is present and passing
    And no source file outside the three tests is modified
