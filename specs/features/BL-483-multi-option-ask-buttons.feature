Feature: Multi-option agent questions surface on Telegram as tappable buttons with one-effect answer capture

  Background:
    Given the front desk is live and round-trips inline-button callbacks
    And an agent can file a question through the ask protocol

  # BL-483 multi-option-ask-buttons-01
  Scenario: An ask carrying enumerated options posts to Telegram with one tappable button per option
    Given an ask that carries a list of enumerated options
    When the ask is posted to Telegram
    Then the post renders one tappable button per option
    And each option's description appears in the message body
    And the message states that a typed reply answers with something else

  # BL-483 multi-option-ask-buttons-02
  Scenario: A button tap routes the chosen option back through the same answer path as a typed reply
    Given an options-carrying ask has been posted with tappable buttons
    When the human taps an option button
    Then the tapped option's label is routed back as the answer
    And the answer is recorded through the one shared answer effect path
    And the callback is acknowledged and the ask message updates as answered

  # BL-483 multi-option-ask-buttons-03
  Scenario: A typed free-text reply still answers an options-carrying ask
    Given an options-carrying ask has been posted with tappable buttons
    When the human answers with a typed free-text reply
    Then the typed reply is recorded as the answer
    And the answer is recorded through the one shared answer effect path

  # BL-483 multi-option-ask-buttons-04
  Scenario: A tap on a retracted or already-answered ask produces no side effect
    Given an options-carrying ask that has been retracted or already answered
    When the human taps an option button
    Then no answer side effect is performed
    And the ask message is edited to show it is no longer open

  # BL-483 multi-option-ask-buttons-05
  Scenario: An ask without options renders byte-identically to the pre-change contract
    Given an ask that carries no options
    When the ask is posted to Telegram
    Then the posted ask renders byte-identically to the pre-change ask contract
