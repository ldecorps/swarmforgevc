Feature: BL-1682 The local seat sends the project briefing as its system prompt
  The local qwen seat answers Telegram questions through ollama with the
  inbound text as the prompt and no project context. This feature is that
  the seat sends docs/reference/local-model-briefing.md, read under the
  target path on every turn, as ollama's own system field, and that a
  missing or empty briefing leaves the request exactly as it always was.

  Background:
    Given a local seat fixture over a scratch target whose endpoint is faked and holds the seat's model

  # BL-1682 the-briefing-rides-as-the-system-field-01
  Scenario: a turn carries the briefing as the system field and the inbound text as the prompt
    Given the scratch target's docs/reference/local-model-briefing.md holds "Project briefing text."
    When the seat completes a turn for "hello"
    Then the completion request carries system "Project briefing text."
    And the completion request's prompt is exactly "hello"

  # BL-1682 no-briefing-sends-the-request-the-seat-always-sent-02
  Scenario Outline: without a usable briefing the request has no system field
    Given the scratch target's briefing file is <state>
    When the seat completes a turn for "hello"
    Then the completion request carries no system value
    And the seat's reply is posted in its topic

    Examples:
      | state                  |
      | absent                 |
      | present but whitespace |
