# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-25T21:08:12.984136495Z","feature_name":"Host queue enqueue-next pin with hold on host question","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1146-host-queue-enqueue-next-hold-on-host-question.feature","background_hash":"72ea461256ac29d4edd9fd43bdb75a02b12a19907b37637d4eb35d0648544519","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: Host queue enqueue-next pin with hold on host question
  While the Host bridge is busy, queued questions wait for a post-idle pick
  poll. The human wants to pre-pin which queued item auto-starts when idle
  ("enqueue next"). If the host agent's finishing message is itself a
  question, the pin must not auto-start on that idle transition — the human
  answers the host first. Maintain path on BL-810/BL-811/BL-894. Source:
  backlog/INTAKE-host-queue-enqueue-next-hold-on-host-question.md.

  Background:
    Given a Host bridge whose Telegram topic is known
    And the bridge queue uses pendingPrompts on cursor-bridge state

  # BL-1146 enqueue-next-pin-while-busy-01
  Scenario: a busy vote can pin enqueue-next instead of being dropped
    Given 2 questions are queued
    And the bridge is busy with a run in flight
    And a queue selection poll is presented with enqueue-next mode
    When the human votes to enqueue-next question 1
    Then enqueueNextPromptId is set to question 1's id
    And the human is told "Enqueued next: <label>. Will start when idle."
    And question 1 remains in pendingPrompts
    And no new agent run starts while busy

  # BL-1146 idle-auto-start-pinned-02
  Scenario: idle with a valid pin and a non-question host reply auto-starts the pin
    Given 2 questions are queued
    And enqueueNextPromptId points at question 1
    And the bridge becomes idle
    And the host agent's finishing reply is not a question
    When the idle transition is processed
    Then question 1 starts as the bridge's next turn
    And question 1 leaves pendingPrompts
    And no choose-next selection poll is posted

  # BL-1146 hold-pin-on-host-question-03
  Scenario: idle with a valid pin holds when the host reply is a question
    Given 2 questions are queued
    And enqueueNextPromptId points at question 1
    And the bridge becomes idle
    And the host agent's finishing reply is a question needing human answer
    When the idle transition is processed
    Then question 1 is not started
    And enqueueNextPromptId still points at question 1
    And no choose-next selection poll is posted on that transition

  # BL-1146 idle-without-pin-unchanged-04
  Scenario: idle without a pin keeps the existing choose-next poll
    Given 2 questions are queued
    And enqueueNextPromptId is unset
    And the bridge becomes idle
    And the host agent's finishing reply is not a question
    When the idle transition is processed
    Then a choose-next selection poll is posted
    And neither question has started yet

  # BL-1146 clear-all-clears-pin-05
  Scenario: clear-all drops the enqueue-next pin with the queue
    Given 2 questions are queued
    And enqueueNextPromptId points at question 1
    When the human votes clear-all on the queue poll
    Then pendingPrompts is empty
    And enqueueNextPromptId is unset

  # BL-1146 stale-pin-ignored-06
  Scenario: a pin for a dropped or expired id is ignored on idle
    Given enqueueNextPromptId points at a prompt id no longer in pendingPrompts
    And the bridge becomes idle
    When the idle transition is processed
    Then enqueueNextPromptId is cleared
    And a choose-next selection poll is posted when questions remain
