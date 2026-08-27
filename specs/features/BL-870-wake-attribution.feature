# mutation-stamp: sha256=8c0de914a05e6e9067693416a642eec93bdb1748c101a604f40389063fed2a76
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-10T10:32:39.887655Z","feature_name":"Every wake the daemon injects records what it was for","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-870-wake-attribution.feature","background_hash":"94582934584029fac0a8888d34f31c0788911e40d49f119df21e5bfbec9ed50e","implementation_hash":"unknown","scenarios":[{"index":2,"name":"the attribution names the sweep that decided the wake","scenario_hash":"06175f184ab90e9077ba7c26fb1a545715a0c825d6e98a47dec9b68bdd7af5c7","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-10T10:32:39.887655Z"},{"index":4,"name":"recording an attribution does not change what the sweep decides","scenario_hash":"37c842cc04a6b63e48e84da06a077c109caed1b91e426123a7fbc788d9f152f8","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-10T10:32:39.887655Z"}]}
# acceptance-mutation-manifest-end

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
