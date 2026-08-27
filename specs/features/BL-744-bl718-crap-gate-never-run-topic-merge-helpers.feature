Feature: BL-718 topic merge helpers meet the CRAP gate with real branch coverage

  # BL-744: six BL-718 functions exceeded CRAP<=6 (worst mergeTopicId at 14% coverage).
  # Pure helpers extracted to bubbleMirror* modules; branch space driven by
  # bl744TopicMergeHelpers.test.js. BL-718 mirror behaviour unchanged.

  Background:
    Given the BL-744 topic merge helper acceptance scope

  # BL-744 topic-merge-tests-01
  Scenario: BL-744 topic merge helper unit tests pass
    When the BL-744 topic merge helper unit tests run
    Then every BL-744 topic merge helper unit test passes

  # BL-744 bl718-regression-02
  Scenario: BL-718 mirror regression stays green
    When the BL-718 letsTalkBridge regression tests run
    Then every BL-718 letsTalkBridge regression test passes

  # BL-744 crap-gate-03
  Scenario: the six BL-718 CRAP targets report CRAP at most 6
    When a scoped CRAP report runs for the BL-744 targets
    Then mergeTopicId reports CRAP at most 6
    And readCursorBridgeTopicIds reports CRAP at most 6
    And mirrorLetsTalkTurnToBubble reports CRAP at most 6
    And mirrorLetsTalkChoicePollToBubble reports CRAP at most 6
    And appendPendingChoicePoll reports CRAP at most 6
    And buildPersistedState reports CRAP at most 6
