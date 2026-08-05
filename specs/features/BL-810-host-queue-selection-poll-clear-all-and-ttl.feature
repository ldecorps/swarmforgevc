Feature: the Host question queue is drained by poll, clear-all, or expiry

  # BL-810: questions typed while the Host bridge is busy are queued and
  # acknowledged, but the pick-one-later experience is incomplete — no
  # clear-all, no age expiry, and auto-present-on-idle does not reliably
  # behave like a product surface. Queued prompts accumulate across shifts and
  # then fire unexpectedly when the bridge next goes idle.
  #
  # Existing plumbing this completes rather than replaces:
  # postQueueSelectionPoll, processQueuedPollAnswer, the pendingPromptPoll
  # single-poll guard, and createdAtMs already on each queued item, all in
  # extension/src/tools/telegramCursorBridgeLive.ts. The poll_answer fan-out
  # from the front desk already exists (BL-764); this slice must keep riding
  # it, never add a second transport.
  #
  # Surface note: this is the Host / Cursor Remote bridge question queue
  # (pendingPrompts), NOT role_ask, NOT Approvals, NOT the pane menus.

  Background:
    Given a Host bridge with queued questions and a known Host topic

  # BL-810 auto-present-on-idle-01
  Scenario: finishing a turn presents the queue without being asked
    Given the Host bridge has just finished working
    And the queue is not empty
    When the bridge poll loop next runs
    Then a queue selection poll is posted to the Host topic
    And the human is not required to send /queue first

  # BL-810 poll-withheld-unless-idle-with-work-02
  Scenario Outline: the poll is withheld unless the bridge is idle with work waiting
    Given the Host bridge is <bridge-state>
    And the queue is <queue-state>
    When the bridge poll loop next runs
    Then no queue selection poll is posted

    Examples:
      | bridge-state          | queue-state |
      | still working         | not empty   |
      | just finished working | empty       |

  # BL-810 one-live-poll-at-a-time-03
  Scenario: an outstanding poll is not duplicated
    Given a queue selection poll is already outstanding for the current queue
    And the Host bridge has just finished working
    When the bridge poll loop next runs
    Then no second queue selection poll is posted

  # BL-810 select-runs-and-dequeues-only-that-item-04
  Scenario: selecting a question runs it and removes only it
    Given a queue selection poll listing three queued questions
    When the human votes for the second question
    Then that question is sent to the Host agent as the next turn
    And that question is removed from the queue
    And the other two questions remain queued

  # BL-810 clear-all-empties-without-running-05
  Scenario: clear-all empties the queue and starts no turn
    Given a queue selection poll listing three queued questions
    When the human votes for the clear-all option
    Then every queued question is removed
    And no question is sent to the Host agent
    And a receipt naming what was cleared is posted

  # BL-810 clear-all-offered-only-when-there-is-something-to-clear-06
  Scenario: the clear-all option accompanies a non-empty queue
    Given the queue is not empty
    When a queue selection poll is posted
    Then the poll offers a clear-all option alongside the queued questions

  # BL-810 expiry-drops-by-age-07
  Scenario Outline: a queued question older than the retention window is dropped
    Given a queued question whose age is <age>
    When the expiry sweep runs
    Then the question is <disposition>
    And it is never sent to the Host agent as a result of the sweep

    Examples:
      | age              | disposition |
      | 71 hours         | kept        |
      | 73 hours         | dropped     |

  # BL-810 expiry-leaves-a-receipt-08
  Scenario: expired questions leave a receipt so nothing vanishes silently
    Given two queued questions older than the retention window
    When the expiry sweep runs
    Then a receipt naming how many were dropped and their age span is posted

  # BL-810 expired-items-never-appear-in-a-poll-09
  Scenario: an expired question is not offered for selection
    Given one queued question older than the retention window
    And one queued question within the retention window
    And the Host bridge has just finished working
    When the bridge poll loop next runs
    Then the queue selection poll offers only the question within the window

  # BL-810 vote-arrives-over-the-existing-fan-out-10
  Scenario: the vote reaches the bridge over the front desk's existing fan-out
    Given a queue selection poll is outstanding
    When the human's vote is delivered by the front desk poll_answer fan-out
    Then the bridge acts on that vote
