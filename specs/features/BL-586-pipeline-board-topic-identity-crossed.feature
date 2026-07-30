Feature: pipeline board topic identity is durable, validated, and reuse-or-create

  # BL-586: the board's ensureBoardTopicAdapter was a bare createForumTopic
  # call with no reuse-or-create and no collision guard. A TickState reset
  # minted a new topic while the previous one became an untracked zombie
  # (observed twice), and nothing cross-validated the stored topicId against
  # telegram-topic-map.json — which already knew id 1634 was a support
  # thread (SUP-7). The live board posted there anyway, including its
  # only-pin enforcement, until a human noticed via screenshot. Repair
  # required the stack to be stopped, because in-memory tick state
  # overwrites a file-only repair within one tick.

  # BL-586 crossed-topic-refused-01
  Scenario: a topicId the topic map attributes to another purpose is refused
    Given the stored pipeline-board topicId is mapped in telegram-topic-map to a support thread
    When the board attempts to post
    Then the post is refused
    And an alert is sent to the Operator topic
    And the board topic is re-ensured
    And the support thread receives nothing

  # BL-586 reuse-or-create-on-state-reset-02
  Scenario: a state reset reuses the recorded standing board topic instead of minting a new one
    Given a PIPELINE_BOARD standing topic id is already recorded
    When TickState resets
    Then the board resolves to the same recorded topic id
    And no new topic is minted

  # BL-586 minted-id-recorded-before-first-post-03
  Scenario: a freshly minted topic id is durably recorded before the first post
    Given no PIPELINE_BOARD standing topic id is recorded
    When the board mints a new topic
    And a crash occurs immediately after minting but before the first post
    Then the minted id is already durably recorded
    And no second topic is minted on the next attempt

  # BL-586 operator-file-repair-takes-effect-within-one-tick-04
  Scenario: an operator's file-level repair of the board identity takes effect within one tick
    Given the stack is running with a crossed pipelineBoard topic id in memory
    When an operator repairs the identity in the durable state file
    Then the next tick reads the repaired identity
    And the in-memory state does not overwrite the repair

  # BL-586 concurrent-writers-log-loudly-05
  Scenario: two concurrent writers of board identity produce a loud log naming both
    Given two front-desk stacks are running concurrently and both write pipelineBoard identity
    When their writes conflict
    Then a loud log line names both identities
    And the board does not post into a topic the surviving state cannot validate

  # BL-586 link-previews-disabled-06
  Scenario: board messages send with link previews disabled
    Given a board message body contains a GitHub link
    When the board sends that message
    Then the message is sent with link previews disabled
