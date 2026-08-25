Feature: BL-1115 stamp-off of Cursor hotfix a3bf11b533
  Commit a3bf11b533 is a human-landed hotfix already on local main with
  Hotfix-Certification: pending. It fixes main_sync_status_cli.bb so
  ahead/behind match handoffd's origin/main...main range+binding.

  This ticket stamps that landed work off — confirm or refute, do not
  reimplement. A human certifies or waives via Approvals and the hotfix
  ledger; green tests alone never certify.

  # BL-1115 rev-list-range-matches-handoffd-01
  Scenario: main_sync_status_cli counts with the same rev-list range as handoffd
    Given the source of swarmforge/scripts/main_sync_status_cli.bb
    When the rev-counts helper is inspected
    Then it runs git rev-list --left-right --count origin/main...main
    And it binds the left count as behind and the right count as ahead

  # BL-1115 absorbed-origin-proceed-02
  Scenario Outline: after origin/main is absorbed the CLI never inverts behind
    Given local main is <ahead> ahead and <behind> behind origin/main
    And the deadlock marker is <deadlock>
    When main_sync_status_cli reports sync status
    Then the reported behind is <behind>
    And the reported ahead is <ahead>
    And the action is <action>

    Examples:
      | ahead | behind | deadlock | action           |
      | 0     | 0      | clear    | proceed          |
      | 3     | 0      | clear    | proceed          |
      | 3     | 0      | active   | proceed          |
      | 0     | 2      | clear    | ff-only          |
      | 3     | 1      | clear    | wait-reconcile   |
      | 3     | 1      | active   | deadlock-tripped |
