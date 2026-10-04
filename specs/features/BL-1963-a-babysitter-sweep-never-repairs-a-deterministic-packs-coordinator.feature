Feature: BL-1963 A babysitter sweep never flags or repairs a deterministic pack's missing coordinator pane

  Split from BL-1932 (2026-10-04): the babysitter path. babysitterd raises
  `pane-coordinator` for the missing seat, escalates to the operator every
  30 minutes and repairs it. Its `should-stand-role?` asks BL-1961's
  topology on a router pack; this slice gives it the pack's mode.

  Background:
    Given a fixture project whose pack declares "config coordinator_mode deterministic" and "config rotation router"
    And a stale coordinator launch script and no coordinator session

  # BL-1963 babysitter-raises-no-coordinator-pane-finding-01
  Scenario: a babysitter sweep neither flags nor repairs the missing coordinator pane
    When a babysitter sweep runs
    Then the sweep raises no pane-coordinator finding
    And the sweep repairs nothing for the coordinator
