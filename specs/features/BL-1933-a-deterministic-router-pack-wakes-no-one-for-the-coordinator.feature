Feature: BL-1933 A deterministic router pack injects nothing into the resident on the coordinator's behalf

  On a rotation-router pack, `resolve-wake-session` sends any recipient that
  has no session of its own to the resident's pane. With a deterministic
  coordinator (no seat, BL-1931) every wake, nudge and context clear meant for
  the coordinator lands in the resident instead: the closing context clear
  reads the resident's fullness and, because BL-1847's relay keeps the
  coordinator's mailbox empty, sends `/clear` and a re-read into the resident
  for each newly done ticket; babysitter findings for the coordinator are
  typed into the resident; and a git_handoff delivered to the coordinator
  wakes the resident for nothing. The coordinator's mail itself is BL-1847's.

  Background:
    Given a fixture project whose pack declares "config coordinator_mode deterministic" and "config rotation router"
    And the resident's session is standing and there is no coordinator session

  # BL-1933 the-coordinator-resolves-to-no-wake-session-01
  Scenario: the coordinator resolves to no wake session while a dormant role still resolves to the resident
    When the wake session for the coordinator is resolved
    Then no session is returned
    And the wake session for a dormant cleaner is the resident's

  # BL-1933 the-closing-context-clear-skips-the-coordinator-02
  Scenario: a closing context clear for the coordinator injects nothing into the resident
    Given a ticket has newly moved to done and the resident's pane reads above the clear threshold
    When the closing context clear sweep runs
    Then nothing is typed into the resident's pane

  # BL-1933 a-coordinator-nudge-is-not-typed-into-the-resident-03
  Scenario: a babysitter nudge addressed to the coordinator is not typed into the resident
    When the babysitter nudges the coordinator with a finding
    Then nothing is typed into the resident's pane
    And the same finding is not attempted again on the next sweep

  # BL-1933 a-non-deterministic-router-pack-wakes-its-own-coordinator-04
  Scenario: a router pack without the deterministic declaration wakes its coordinator in the coordinator's own session
    Given the fixture pack's "config coordinator_mode deterministic" line is removed
    And a coordinator session exists
    When the wake session for the coordinator is resolved
    Then the wake session is the coordinator's own
