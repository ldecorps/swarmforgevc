Feature: The Concierge runtime derives task events from the live backlog and routes each into its BL-### topic, persisting the topic map

  Background:
    Given the Concierge runtime is ticking over the swarm's live backlog state

  # BL-300 concierge-wiring-01
  Scenario Outline: routing a backlog item that has newly <lifecycle>
    Given a backlog item that has newly <lifecycle>
    When the runtime tick derives and routes events
    Then it <outcome>

    Examples:
      | lifecycle | outcome |
      | started being worked | creates the item's topic, posts its opening message, and persists the backlog-id-to-topic-id mapping for later reads |
      | completed | posts a completion summary into the item's topic and closes it |

  # BL-300 concierge-wiring-02
  Scenario: an event handled before a restart is not routed again after it
    Given an event already routed before the runtime restarted
    When the tick runs once more following the restart
    Then that event is not routed a second time
