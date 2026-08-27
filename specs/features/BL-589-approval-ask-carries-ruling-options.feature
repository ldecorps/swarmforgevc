Feature: BL-589 An approval ask that poses a multiple-choice ruling surfaces its options as tappable choices

  Background:
    Given an approval ask was posted in a ticket's Telegram topic

  Scenario: ruling-options-01 A ticket declaring ruling options renders one tappable choice per option alongside the default verbs
    Given the ticket declares ruling options on its yaml
    When the approval ask inline keyboard is composed for the ticket
    Then one inline button is rendered per ruling option alongside today's default approval verbs

  Scenario: ruling-options-02 Tapping a ruling option records the chosen option durably and repaints the ask showing which option was chosen
    Given the ticket declares ruling options on its yaml
    And the ticket is still pending review
    When a ruling option button on the ask is tapped
    Then the ticket records human_ruling with the chosen option label
    And the ask message is repainted with a Ruled footer naming that option

  Scenario: ruling-options-03 A ticket with no ruling options renders exactly today's five-button keyboard
    Given the ticket has no ruling options declared
    When the approval ask inline keyboard is composed for the ticket
    Then the inline keyboard matches today's default approval ask buttons byte-for-byte

  Scenario: ruling-options-04 A ruling option label too long for callback_data uses index indirection in callback_data
    Given the ticket declares a ruling option whose label exceeds the callback_data byte budget
    When the approval ask inline keyboard is composed for the ticket
    Then the long option's callback_data carries only the option index not the label text

  Scenario: ruling-options-05 A stale tap on an already-ruled ask is idempotent and names the recorded ruling
    Given the ticket declares ruling options on its yaml
    And the ticket already carries a recorded human ruling
    When a ruling option button on the ask is tapped again
    Then the tap is answered with an already-ruled toast naming the recorded option
    And no further ruling is recorded on the ticket
