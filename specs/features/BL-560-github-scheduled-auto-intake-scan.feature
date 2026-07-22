Feature: A scheduled GitHub Actions scan auto-intakes open issues into the backlog root

  # BL-560 — Slice 1 of epic BL-558 (github-auto-intake). Complements the
  # existing label-triggered swarm-intake.yml; does not replace it.
  # Infrastructure adapter only — no LLM in this loop.

  # BL-560 scan-01
  Scenario: an open issue without a backlog file is intaked on the next scan
    Given an open GitHub issue with number N and no swarm-intake label
    And no file matching backlog/GH-N-*.yaml exists on main
    When the scheduled auto-intake workflow runs
    Then a file backlog/GH-N-<slug>.yaml is committed on main
    And the file's id is GH-N and source is the issue URL
    And the issue receives a queued-for-swarm comment naming that path
    And the issue is labeled swarm-intake

  # BL-560 scan-02
  Scenario: an issue that already has a GH-N backlog file is skipped
    Given an open GitHub issue with number N
    And backlog/GH-N-existing.yaml already exists on main
    When the scheduled auto-intake workflow runs
    Then no second GH-N file is created
    And the workflow exits successfully

  # BL-560 scan-03
  Scenario: an issue already labeled swarm-specced is not re-intaked
    Given a closed or open issue with label swarm-specced
    When the scheduled auto-intake workflow runs
    Then no new backlog/GH-<n>-*.yaml is created for that issue

  # BL-560 scan-04
  Scenario: parallel intakes both land on main
    Given two distinct open issues N and M without backlog files
    When two auto-intake workflow runs commit in parallel
    Then both backlog/GH-N-*.yaml and backlog/GH-M-*.yaml exist on main
    And neither workflow fails its push step

  # BL-560 scan-05
  Scenario: the manual label-triggered intake path still works
    Given the existing swarm-intake.yml label workflow
    When a human adds the swarm-intake label to an issue
    Then the same GH-N yaml shape is written as the scheduled scan
