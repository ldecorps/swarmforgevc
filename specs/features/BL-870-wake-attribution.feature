Feature: Every wake the daemon injects records what it was for

  Background:
    Given a daemon sweep over a role whose pane can be woken

  # BL-870 wake-attribution-01
  Scenario: a wake driven by mail records the handoff that motivated it
    Given the role's inbox holds a handoff
    When the sweep wakes that role
    Then a wake attribution is recorded for that role
    And the attribution names that handoff

  # BL-870 wake-attribution-02
  Scenario: a wake injected with no mail behind it is recorded as unattributed
    Given the role's inbox holds no handoff
    When the sweep wakes that role
    Then a wake attribution is recorded for that role
    And the attribution marks the motivating handoff as absent

  # BL-870 wake-attribution-03
  Scenario Outline: the attribution names the sweep that decided the wake
    Given a sweep decision of "<sweep>" for that role
    When the sweep wakes that role
    Then the attribution names the sweep as "<sweep>"

    Examples:
      | sweep             |
      | inbox-item        |
      | stuck-in-process  |
      | claim-idle-probe  |

  # BL-870 wake-attribution-04
  Scenario: a wake that was skipped is recorded with the same motivation as one that lands
    Given the role's inbox holds a handoff
    And the target pane reads as busy
    When the sweep wakes that role
    Then a wake attribution is recorded for that role
    And the attribution names that handoff
    And the attribution records the outcome as skipped

  # BL-870 wake-attribution-05
  Scenario Outline: recording an attribution does not change what the sweep decides
    Given the role's inbox holds a handoff
    When the sweep runs with attribution recording "<recording>"
    Then the sweep's outcome for that role is "woken"

    Examples:
      | recording |
      | on        |
      | off       |
