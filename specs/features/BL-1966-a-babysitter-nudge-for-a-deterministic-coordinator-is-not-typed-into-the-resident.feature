Feature: BL-1966 A babysitter nudge for a deterministic coordinator is not typed into the resident

  Split from BL-1933 (2026-10-04): the babysitter nudge. babysitter findings
  for the coordinator are typed into the resident's pane, and because the
  dedup stamp is written only when a nudge lands, a nudge with nowhere to go
  is retried every sweep. BL-1964 resolves the coordinator to no wake
  session.

  Background:
    Given a fixture project whose pack declares "config coordinator_mode deterministic" and "config rotation router"
    And the resident's session is standing and there is no coordinator session

  # BL-1966 a-coordinator-nudge-is-not-typed-into-the-resident-01
  Scenario: a babysitter nudge addressed to the coordinator is not typed into the resident
    When the babysitter nudges the coordinator with a finding
    Then nothing is typed into the resident's pane
    And the same finding is not attempted again on the next sweep
