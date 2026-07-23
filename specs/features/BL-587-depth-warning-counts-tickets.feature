Feature: the active-backlog depth warning counts tickets, not directory entries

  # BL-587: swarm_handoff.bb's check-backlog-depth counts raw directory entries, so the
  # tracked .gitkeep in backlog/active/ is counted as a ticket and the warning fires one
  # item early — observed 2026-07-23 with a single active ticket at cap 1, on every send.
  # chase_sweep_lib/count-backlog-yaml already solves exactly this ("Ignores non-yaml
  # (e.g. .gitkeep)") and is what handoffd's own open-slot sweep uses; the send path was
  # never migrated to it. A warning that cries wolf on every handoff is worse than none.

  Background:
    Given backlog/active/ contains the tracked .gitkeep placeholder
    And active_backlog_max_depth is 1

  # BL-587 placeholder-is-not-a-ticket-01
  Scenario: one real ticket at the cap sends without a depth warning
    Given backlog/active/ holds one ticket yaml
    When a role sends a handoff
    Then no active-backlog depth warning is printed

  # BL-587 genuine-overflow-still-warns-02
  Scenario: a genuinely over-cap backlog still warns
    Given backlog/active/ holds two ticket yamls
    When a role sends a handoff
    Then an active-backlog depth warning naming two active items is printed
