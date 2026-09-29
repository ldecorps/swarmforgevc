Feature: BL-1806 A land-plan over a fat QA tip finishes fast

  BL-1461 restored land-plan's candidate walk to the full
  origin/main..<cited> ancestry so a sibling absorbed before the parcel's
  last hop can never read as LAND_CLEAN. Post-land re-point (BL-1438 /
  BL-1773 / BL-1803 / BL-1805) is the cost BOUND that keeps that range
  short. When re-point lags, the tip re-fattens through merge history
  (live 2026-09-29: 4139 full ancestry commits vs 11 first-parent) and
  land-plan spends tens of minutes to an hour before printing a verdict
  (BL-1793). This ticket is the cost FLOOR: the walk still sees every
  commit in the full ancestry, but its per-commit IO no longer scales
  with merge-DAG size. Fixtures under mkdtemp with their own bare origin
  (BL-1390); never the live QA worktree.

  Background:
    Given a fixture repository whose origin/main is behind a QA tip

  # BL-1806 a-fat-tip-land-plan-finishes-under-ten-seconds-01
  Scenario: a fat tip's land-plan returns a verdict in under ten seconds
    Given the QA tip's full ancestry has at least 1000 commits and its first-parent ancestry has fewer than 20
    And the tip carries only the landing ticket's own work since origin/main
    When land-plan runs for the landing ticket at that tip
    Then it returns a verdict in under 10 seconds
    And the verdict matches a tip-pure equivalent of the same parcel

  # BL-1806 a-pre-hop-sibling-still-forces-replay-02
  Scenario: a sibling absorbed before the parcel's last hop still forces LAND_REPLAY
    Given an unlanded sibling's work was absorbed before the landing ticket's last hop
    And the QA tip's full ancestry has at least 1000 commits
    When land-plan runs for the landing ticket at that tip
    Then the verdict is LAND_REPLAY naming that sibling
