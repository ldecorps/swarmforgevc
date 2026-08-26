Feature: the active-backlog depth warning counts tickets, not directory entries

  # BL-562 (absorbs the retired duplicate BL-587): swarm_handoff.bb's check-backlog-depth
  # counts raw directory entries with (count (fs/list-dir active-dir)), so the tracked
  # backlog/active/.gitkeep placeholder is counted as a ticket and the warning fires one
  # item early — observed 2026-07-23 with a single active ticket at cap 1, on every send.
  # Every other active-count call site already filters to *.yaml, and
  # chase_sweep_lib/count-backlog-yaml says so in its own docstring ("Ignores non-yaml
  # (e.g. .gitkeep)"); handoffd's open-slot sweep uses it for the same question, so the
  # warning and the nudge currently disagree by one about the same directory. A warning
  # that cries wolf on every handoff trains every role to ignore the one that matters.

  Background:
    Given active_backlog_max_depth is 1

  # BL-562 non-ticket-entry-is-not-counted-01
  Scenario Outline: a non-ticket entry beside one real ticket does not trip the warning
    Given backlog/active/ holds one ticket yaml
    And backlog/active/ also holds <non-ticket entry>
    When a role sends a handoff
    Then no active-backlog depth warning is printed

    Examples:
      | non-ticket entry              |
      | the tracked .gitkeep placeholder |
      | a stray notes.md file         |

  # BL-562 genuine-overflow-still-warns-02
  Scenario: a genuinely over-cap backlog still warns and counts only tickets
    Given backlog/active/ holds two ticket yamls
    And backlog/active/ also holds the tracked .gitkeep placeholder
    When a role sends a handoff
    Then an active-backlog depth warning naming two active items is printed

  # BL-562 missing-directory-degrades-03
  Scenario: a missing active-backlog directory degrades rather than crashing the send
    Given backlog/active/ does not exist
    When a role sends a handoff
    Then no active-backlog depth warning is printed
    And the send is not aborted by a depth-check error
