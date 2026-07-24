Feature: A pipeline role raises a clarifying question into its own topic and gets the answer back into its own session

  Background:
    Given the front desk is live and round-trips inline-button callbacks
    And each pipeline role has its own dedicated topic in the role topic map

  # BL-607 specifier-clarifying-poll-01
  Scenario: A clarifying question raised by the specifier lands in the specifier's own topic
    Given the specifier is drafting a spec and hits an ambiguous choice
    When the specifier raises a clarifying question carrying enumerated options
    Then the question is posted to the specifier's own role topic
    And it is not posted to the shared agent questions topic
    And the post renders one tappable button per option

  # BL-607 specifier-clarifying-poll-02
  Scenario: Tapping an option delivers the chosen answer into the asking role's live session
    Given the specifier has a clarifying question pending and its pane is live
    When the human taps an option button
    Then the chosen option is delivered into the specifier's live pane
    And the pending question for that role is cleared

  # BL-607 specifier-clarifying-poll-03
  Scenario: A typed free-text reply answers a question when no offered option fits
    Given the specifier has a clarifying question pending and its pane is live
    When the human answers with a typed free-text reply
    Then the typed reply is delivered into the specifier's live pane
    And the pending question for that role is cleared

  # BL-607 specifier-clarifying-poll-04
  Scenario: An answer for a role whose pane is dormant is queued to that role's inbox
    Given the specifier has a clarifying question pending and its pane is dormant
    When the human answers the question
    Then the answer is queued as a note in the specifier's inbox
    And the answer is not reported as delivered to a live pane

  # BL-607 specifier-clarifying-poll-05
  Scenario: A second question from a role that already has one pending is refused
    Given the specifier has a clarifying question pending
    When the specifier raises another clarifying question
    Then the second question is refused
    And the first pending question is left untouched

  # BL-607 specifier-clarifying-poll-06
  Scenario: The operator's existing support-thread ask is unchanged
    Given the operator raises a question against a support thread
    When the question is posted to Telegram
    Then it is posted to the shared agent questions topic exactly as before
