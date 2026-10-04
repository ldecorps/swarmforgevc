Feature: BL-1965 A closing context clear types nothing into the resident for a deterministic coordinator

  Split from BL-1933 (2026-10-04): the closing clear. The closing context
  clear reads the coordinator's fullness and, because BL-1847's relay keeps
  the coordinator's mailbox empty, sends `/clear` and a re-read for each
  newly done ticket; on a router pack those land in the resident's pane.
  BL-1964 resolves the coordinator to no wake session.

  Background:
    Given a fixture project whose pack declares "config coordinator_mode deterministic" and "config rotation router"
    And the resident's session is standing and there is no coordinator session

  # BL-1965 the-closing-context-clear-skips-the-coordinator-01
  Scenario: a closing context clear for the coordinator injects nothing into the resident
    Given a ticket has newly moved to done and the resident's pane reads above the clear threshold
    When the closing context clear sweep runs
    Then nothing is typed into the resident's pane
