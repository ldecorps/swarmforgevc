Feature: BL-1964 On a deterministic router pack the coordinator resolves to no wake session

  Split from BL-1933 (2026-10-04): the shared decision. On a rotation-router
  pack `handoff_lib.bb`'s `resolve-wake-session` sends any recipient that
  has no session of its own to the resident's pane. With a deterministic
  coordinator (no seat, BL-1959) every wake, nudge and context clear meant
  for the coordinator lands in the resident. The closing context clear
  (BL-1965) and the babysitter nudge (BL-1966) both reach the resident
  through this resolver.

  Background:
    Given a fixture project whose pack declares "config coordinator_mode deterministic" and "config rotation router"
    And the resident's session is standing and there is no coordinator session

  # BL-1964 the-coordinator-resolves-to-no-wake-session-01
  Scenario: the coordinator resolves to no wake session while a dormant role still resolves to the resident
    When the wake session for the coordinator is resolved
    Then no session is returned
    And the wake session for a dormant cleaner is the resident's

  # BL-1964 a-non-deterministic-router-pack-wakes-its-own-coordinator-02
  Scenario: a router pack without the deterministic declaration wakes its coordinator in the coordinator's own session
    Given the fixture pack's "config coordinator_mode deterministic" line is removed
    And a coordinator session exists
    When the wake session for the coordinator is resolved
    Then the wake session is the coordinator's own
