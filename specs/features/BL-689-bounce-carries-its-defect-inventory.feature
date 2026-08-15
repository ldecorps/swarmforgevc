# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-15T08:53:20.596237Z","feature_name":"One bounce event carries its whole defect inventory","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-689-bounce-carries-its-defect-inventory.feature","background_hash":"8845323f533580a8c0104851e868cee92c5af731cdf0b4067af2d29fe1698177","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: One bounce event carries its whole defect inventory

  Background:
    Given an empty bounce log

  # BL-689 bounce-carries-its-defect-inventory-01
  Scenario Outline: An inventory of any size records exactly one bounce event
    When a bounce is recorded with an inventory of "<items>" defects and "<blocked>" blocked checks
    Then the bounce log holds "1" records
    And that record carries "<items>" inventory items and "<blocked>" blocked checks

    Examples:
      | items | blocked |
      | 1     | 0       |
      | 4     | 3       |

  # BL-689 bounce-carries-its-defect-inventory-02
  Scenario: Every tally counts a multi-item bounce once, never once per item
    When a bounce is recorded with an inventory of "4" defects and "0" blocked checks
    And the briefing bounce line is printed
    Then it reports a total of "1" bounces
    And it reports "4" defects for that bounce

  # BL-689 bounce-carries-its-defect-inventory-03
  Scenario: A call with no inventory writes the record it wrote before this ticket
    When a bounce is recorded with no inventory
    Then the bounce log holds "1" records
    And that record carries no inventory field
    And the briefing bounce line reports a total of "1" bounces

  # BL-689 bounce-carries-its-defect-inventory-04
  Scenario Outline: A rejected inventory degrades to the single-item bounce, never loses it
    When a bounce is recorded with the inventory "<inventory>"
    Then the bounce log holds "1" records
    And that record carries no inventory field
    And the recorder reports the degrade reason "<reason>"
    And the recorder exits zero

    Examples:
      | inventory                                        | reason        |
      | {not json                                        | unparseable   |
      | []                                               | empty         |
      | [{"id":"D1","class":"flaky","blamed":"coder"}]    | invalid-item  |
      | [{"id":"D1","class":"unit","blamed":"operator"}]  | invalid-item  |

  # BL-689 bounce-carries-its-defect-inventory-05
  Scenario: Each inventory item names its own class, blamed role and remediation pointer
    When a bounce is recorded with an inventory of "2" defects and "0" blocked checks
    Then inventory item "1" carries a class, a blamed role and a remediation pointer
    And inventory item "2" carries a class, a blamed role and a remediation pointer

  # BL-689 bounce-carries-its-defect-inventory-06
  Scenario: The defects-per-bounce figure the briefing prints comes from the durable log
    Given a bounce is recorded with an inventory of "4" defects and "0" blocked checks
    And a bounce is recorded with no inventory
    When the briefing bounce line is printed
    Then it reports a total of "2" bounces
    And it reports a defects-per-bounce figure of "2.5"
