# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-10T07:47:00.776901703Z","feature_name":"readBacklogFolders keeps tickets whose status field is absent or unrecognized","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-234-readbacklogfolders-keeps-status-less-tickets.feature","background_hash":"9bc3d6bab14835e4400ba66757569ba63ce164c16f61bf425a613b52d86301e0","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a ticket with no status field is still bucketed by its folder","scenario_hash":"0e3e82bbdd49edfcd49779e2a39689800ec449420ad047e6722577ec17e33f20","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-10T07:47:00.776901703Z"},{"index":3,"name":"a file missing a required field is skipped, not bucketed","scenario_hash":"268fd359a73a5dca7bb73e5c75c0f9aeb18958b5297b32e1518d820a631099aa","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-10T07:47:00.776901703Z"}]}
# acceptance-mutation-manifest-end

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
