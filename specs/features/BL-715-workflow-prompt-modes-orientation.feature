Feature: Workflow articles orient agents on queue-jump, ambulance, and expeditor
  Seats re-reading workflow rules must learn that the normal live swarm is
  default, and that queue-jump, ambulance, and the expeditor are three distinct
  specials — not a second constitution, and not three names for one thing.
  Source: human via Let's Talk / Cursor 2026-07-30; BL-715.

  Background:
    Given the swarm workflow rules article
    And the workflow detailed reference article

  # BL-715 modes-01
  Scenario: normal live swarm is named as the default
    When I read the workflow rules orientation
    Then it states that the normal live swarm is the default path
    And it states that other modes do not replace that path

  # BL-715 modes-02
  Scenario Outline: each required special is named with its one-line job
    When I read the workflow rules orientation
    Then it names <mode>
    And it states that <mode> <effect>

    Examples:
      | mode       | effect                                                       |
      | queue-jump | promotes sooner then walks the normal live pipeline          |
      | ambulance  | holds other parcels on a live stack for one ticket           |
      | expeditor  | drives one ticket with the swarm stopped                     |

  # BL-715 modes-03
  Scenario: the three specials are not conflated
    When I read the workflow orientation
    Then it states that queue-jump is not ambulance
    And it states that queue-jump is not the expeditor
    And it states that ambulance is not the expeditor

  # BL-715 modes-04
  Scenario: legacy expedite wording is disambiguated if mentioned
    When I read the workflow orientation
    Then if it mentions expedite it ties that word to queue-jump or the expeditor explicitly
    And it does not use expedite alone as the primary name for queue-jump

  # BL-715 modes-05
  Scenario: orientation is prose only
    When I inspect the change that adds the orientation
    Then it changes workflow governance articles only
    And it does not change daemon, promotion, or ambulance-marker behavior
