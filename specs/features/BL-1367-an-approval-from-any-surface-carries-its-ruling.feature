Feature: An approval from any surface carries its ruling

  A ticket that poses a choice declares `ruling_options`, and the tap that
  answers it records a `human_ruling:` block. That works from the bot's ruling
  keyboard: 36 tickets carry such a block.

  It cannot work from the paused-pager Mini App. That route's Approve calls
  `recordApprovalReply(targetPath, backlogId)` - a signature with no ruling
  parameter - which flips `human_approval` and nothing else. So an approval
  tapped on the phone pager records consent and silently discards the answer,
  for any ticket, however many options it declares.

  The damage is not the missing field. It is that the ticket then reads as
  fully approved while the one thing the implementer needs is still unknown,
  and the next role builds on a guess. BL-1309 was approved that way on
  2026-09-01, its binary refusal-width question was never answered, and the
  work proceeded on an assumed option.

  Background:
    Given a ticket pending human approval

  # BL-1367 an-approval-from-any-surface-carries-its-ruling-01
  Scenario: approving from the pager records the ruling that was chosen
    Given the ticket declares ruling options
    And the human approves from the paused pager choosing an option
    When the approval is recorded
    Then the ticket records that option as the human ruling
    And the ticket records approval

  # BL-1367 an-approval-from-any-surface-carries-its-ruling-02
  Scenario: a surface that cannot offer the options does not record consent alone
    Given the ticket declares ruling options
    And the human approves from a surface that offered no options
    When the approval is recorded
    Then the ticket is not left approved with no ruling

  # BL-1367 an-approval-from-any-surface-carries-its-ruling-03
  Scenario: a ticket posing no choice approves from the pager as before
    Given the ticket declares no ruling options
    And the human approves from the paused pager
    When the approval is recorded
    Then the ticket records approval
    And the ticket records no human ruling

  # BL-1367 an-approval-from-any-surface-carries-its-ruling-04
  Scenario: an existing ruling is never overwritten by a later plain approval
    Given the ticket already records a human ruling
    And the human approves from the paused pager
    When the approval is recorded
    Then the recorded human ruling is unchanged
