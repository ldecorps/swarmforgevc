Feature: Swarm emits a typed, Telegram-agnostic event stream tagged by BL-###

  Background:
    Given the swarm's activity is turned into typed events without any knowledge of Telegram

  # BL-296 typed-events-01
  Scenario Outline: a swarm signal for a backlog item emits its typed event
    Given a backlog item <trigger>
    When the event stream is derived
    Then it includes a <eventType> event tagged with that backlog item

    Examples:
      | trigger | eventType |
      | that has just started being worked | TaskStarted |
      | whose work has captured a to-human gate | NeedsApproval |
      | that has just completed | TaskCompleted |

  # BL-296 typed-events-02
  Scenario: no emitted event carries any Telegram or topic reference
    Given an emitted event
    When it is inspected
    Then it names its type and its backlog item but nothing about Telegram or topics

  # BL-296 typed-events-03
  Scenario: an already-emitted event is not emitted twice
    Given an event already emitted for a backlog item
    When the stream is derived again with no new change
    Then that event is not emitted again
