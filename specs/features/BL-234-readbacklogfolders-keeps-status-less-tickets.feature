Feature: readBacklogFolders keeps tickets whose status field is absent or unrecognized

  # Bug (coordinator 2026-07-10): readBacklogFolders drops any ticket whose
  # status: field is missing or not in {todo, active, done}. Both parser paths
  # (extractRequiredFields, parseBacklogYamlLenient) return null in that case, so
  # the ticket vanishes from the dashboard, read bridge, delivery metrics, and
  # docs tree. This contradicts the documented "folder is authoritative" design:
  # a ticket's bucket is the folder it sits in, not its status field. Live drops
  # confirmed: BL-233 (no status field), BL-101 (status: blocked). A paused-folder
  # ticket honestly marked "status: paused" would drop too (paused is unrecognized).

  Background:
    Given a backlog with active/, paused/, and done/ folders read by readBacklogFolders

  # BL-234 no-status-field-01
  Scenario Outline: a ticket with no status field is still bucketed by its folder
    Given a ticket in the "<folder>" folder with a valid id and title but no status field
    When readBacklogFolders reads the backlog
    Then the ticket appears in the "<folder>" bucket

    Examples:
      | folder |
      | active |
      | paused |
      | done   |

  # BL-234 unrecognized-status-02
  Scenario Outline: a ticket whose status value is unrecognized is still bucketed by its folder
    Given a ticket in the "<folder>" folder whose status is "<status>"
    When readBacklogFolders reads the backlog
    Then the ticket appears in the "<folder>" bucket

    Examples:
      | folder | status  |
      | paused | blocked |
      | paused | paused  |
      | active | blocked |

  # BL-234 folder-over-stale-status-03
  Scenario: the folder is authoritative over a stale but valid status field
    Given a ticket in the paused folder whose status is "active"
    When readBacklogFolders reads the backlog
    Then the ticket appears in the paused bucket, not the active bucket

  # BL-234 unparseable-skipped-04
  Scenario Outline: a file missing a required field is skipped, not bucketed
    Given a file in the paused folder missing its "<required>"
    When readBacklogFolders reads the backlog
    Then that file is not reported in any bucket

    Examples:
      | required |
      | id       |
      | title    |

  # BL-234 none-dropped-05
  Scenario: no parseable ticket is silently dropped from its folder
    Given a paused folder of tickets with absent, unrecognized, and valid status values
    When readBacklogFolders reads the backlog
    Then the paused bucket contains every parseable ticket in the folder
