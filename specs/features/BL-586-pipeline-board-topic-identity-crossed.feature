Feature: pipeline board topic identity is validated on every resolve and reuse-or-create

  # BL-586. Board identity lives in exactly one place -
  # TickState.pipelineBoard.topicId - and resolveBoardTopicId
  # (extension/src/concierge/pipelineBoardSync.ts) trusts it unconditionally:
  # if a topicId is present it is returned with no validation, and if it is
  # absent ensureBoardTopicAdapter mints a brand new topic with no
  # reuse-lookup and no durable record. Both halves have fired in production.
  # On 2026-07-23 the stored id was 1634, which telegram-topic-map.json
  # already knew was SUP-7, a support thread; on 2026-08-21 it was 14647 =
  # SUP-5. In both cases the board - including its only-pin enforcement -
  # posted into the human's support topic, and the map held the answer that
  # would have refused the post. Meanwhile BL-497's topic-gone self-heal
  # clears topicId, so every such failure mints another untracked "Pipeline
  # Board" zombie.
  #
  # These scenarios pin the two invariants the ticket declares: validate
  # before EVERY post (not only at mint time), and re-establish identity by
  # reuse-or-create against a durable standing-topic record. Scenario 04 is
  # how this ticket discharges the operator-repair requirement - a crossed
  # identity self-corrects on the next tick, so no stack-down file repair is
  # needed. The deferred multi-writer and posting-noise scenarios are parked
  # in BL-586-pipeline-board-noise-and-multi-writer.feature.draft.

  Background:
    Given the front-desk pipeline board is wired to a forum-enabled chat

  # BL-586 crossed-topic-refused-01
  Scenario Outline: a stored board topic id the topic map attributes to another purpose is refused before any post
    Given the topic map attributes topic id <topicId> to <subject>
    And the stored pipeline-board topic id is <topicId>
    When the board resolves its topic for a post
    Then the board refuses to post into <topicId>
    And an operator alert naming <topicId> and <subject> is emitted
    And the board re-ensures its topic from the durable standing record

    Examples:
      | topicId | subject   |
      | 14647   | SUP-5     |
      | 1785    | APPROVALS |
      | 3864    | OPERATOR  |

  # BL-586 reuse-or-create-on-state-reset-02
  Scenario: a tick-state reset reuses the recorded standing board topic instead of minting a new one
    Given the standing topic record holds PIPELINE_BOARD as topic id 6795
    And the pipeline-board tick state holds no topic id
    When the board resolves its topic for a post
    Then the board resolves to topic id 6795
    And no new topic is minted

  # BL-586 minted-id-recorded-before-first-post-03
  Scenario: a newly minted board topic is recorded durably before the board's first post into it
    Given the standing topic record holds no PIPELINE_BOARD entry
    And the pipeline-board tick state holds no topic id
    When the board mints a new topic
    Then the minted id is written to the standing topic record before any post is attempted
    And the topic map binds the minted id to PIPELINE_BOARD

  # BL-586 crossed-identity-self-corrects-without-stack-down-04
  Scenario: a crossed in-memory identity self-corrects on the next tick with no operator intervention
    Given the pipeline-board tick state holds topic id 14647 in memory
    And the topic map attributes topic id 14647 to SUP-5
    And the standing topic record holds PIPELINE_BOARD as topic id 6795
    When the board resolves its topic for a post
    Then the board resolves to topic id 6795
    And topic id 14647 receives no board post
