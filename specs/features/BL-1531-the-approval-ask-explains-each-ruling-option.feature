Feature: BL-1531 The Telegram approval ask explains each ruling option before the human is asked to choose

  A ticket that poses a choice declares `ruling_options`, and the
  Approvals-topic ask renders those options ONLY as inline buttons
  (BL-589), each label cut at 64 characters. The message text names no
  option at all, and its "Approval context" line is capped at 300
  characters like every other summary field, then the whole body is
  capped at 1000 (extension/src/concierge/topicRouter.ts). On BL-1529 the
  human saw a title, a context cut mid-sentence, and two buttons that both
  began "The challenge ..." - and had to have the yaml read out before
  they could choose (human, 2026-09-11: "what to chose? pros and cons
  should be explained on the telegram message").

  This slice gives each option a letter, lists every option in the text
  with its label and the specifier's stated trade-offs from a new
  `ruling_tradeoffs` list (one line per option, same order as
  `ruling_options`), lets the approval context run to Telegram's own
  limit instead of a fixed 300, and prefixes each option button with its
  letter. The frozen reply-grammar line (BL-480) and the five default
  verb buttons (BL-589) are untouched. How a human picks an option by
  TYPING its letter is BL-1532's slice, not this one.

  Background:
    Given a ticket pending human approval whose Approvals-topic ask is being composed

  # BL-1531 approval-ask-explains-each-ruling-option-01
  Scenario: every option is listed in the text with its letter, label, and trade-offs, in declared order
    Given the ticket declares two ruling options and a ruling_tradeoffs line for each
    When the approval ask text is composed
    Then the text lists each option with its letter, its label, and its trade-offs line, in declared order
    And the text tells the human to pick an option by naming the letters A and B

  # BL-1531 approval-ask-explains-each-ruling-option-02
  Scenario: a ticket that declares options but no trade-offs lists the lettered labels and invents nothing
    Given the ticket declares two ruling options and no ruling_tradeoffs
    When the approval ask text is composed
    Then the text lists option A and option B with their labels
    And the text carries no trade-offs line for either option

  # BL-1531 approval-ask-explains-each-ruling-option-03
  Scenario: a ticket posing no choice gets no option block and no pick hint
    Given the ticket declares no ruling options
    When the approval ask text is composed
    Then the text carries no option block
    And the text carries no pick hint

  # BL-1531 approval-ask-explains-each-ruling-option-04
  Scenario: an approval context longer than the old field cap is shown whole
    Given the ticket carries an approval context of 1500 characters whose last sentence is marked FIRM
    When the approval ask text is composed
    Then the approval context appears whole in the text, its final FIRM sentence included

  # BL-1531 approval-ask-explains-each-ruling-option-05
  Scenario: an approval context longer than Telegram allows is cut before the options or the reply line
    Given the ticket declares two ruling options and a ruling_tradeoffs line for each
    And the ticket carries an approval context of 6000 characters
    When the approval ask text is composed
    Then the text is within the Telegram message length limit
    And the approval context ends with an ellipsis
    And the text lists option A and option B with their labels
    And the text still contains the frozen reply-grammar line for approving or rejecting by id

  # BL-1531 approval-ask-explains-each-ruling-option-06
  Scenario: each option button carries its letter and keeps its index callback
    Given the ticket declares two ruling options
    When the approval ask inline keyboard is composed
    Then the first option button label starts with the letter A and the second with the letter B
    And each option button's callback_data still carries the ticket id and the option index
    And the default approval verb buttons follow the option buttons unchanged
