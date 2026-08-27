Feature: the NeedsApproval snippet carries the question, not the terminal's input box and footer

  Background:
    Given the human-facing approval snippet is extracted from an agent's captured pane

  # BL-395 approval-chrome-01
  Scenario: the input-box border rules are excluded from the snippet
    Given a captured pane whose tail is the agent's input box drawn with box-rule lines
    When the approval snippet is extracted
    Then the snippet contains none of those box-rule border lines

  # BL-395 approval-chrome-02
  Scenario: the terminal permission-mode and shortcut footer is excluded
    Given a captured pane whose tail includes the terminal permission-mode and shortcut footer
    When the approval snippet is extracted
    Then the snippet contains none of that footer furniture

  # BL-395 approval-chrome-03
  Scenario: the actual question survives the chrome filter
    Given a captured pane whose real question sits above its input box and footer
    When the approval snippet is extracted
    Then the snippet is that question text

  # BL-395 approval-chrome-04
  Scenario: an ordinary prose message is left unchanged
    Given a human-facing message that is ordinary prose containing no terminal chrome
    When the approval snippet is extracted
    Then the message is delivered unchanged

  # BL-395 approval-chrome-05
  Scenario: the ticket's topic record is free of the chrome too
    Given a captured pane whose tail is terminal chrome
    When the snippet is recorded against the ticket
    Then the recorded snippet contains none of that chrome
