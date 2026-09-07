Feature: BL-1459 A documenter briefing lands on main through a QA note, inside its lane, once per day

  The documenter authors docs/briefings/<date>.md (human ruling A,
  2026-09-07) in its own worktree and cannot land. Until now its briefings
  reached main by hand - cherry-picked on 2026-09-05, committed directly on
  2026-09-06 - or not at all, while the same composition walked five pipeline
  stages to a QA no-op. BL-1444 gave the art director a landing path: a note
  to QA naming the tip, a lane guard in the shared pre-merge-commit chain,
  QA's ordinary land recipe. This parcel gives the documenter's briefing the
  same path with its own lane: the day's briefing file, never the email
  sweep's sent-state, and never a second briefing for a day main already
  carries - the human receives one briefing per morning.

  Background:
    Given a fixture repository with a landed main and a documenter branch

  # BL-1459 a-tip-inside-the-lane-is-accepted-01
  Scenario: a documenter commit that changes only the day's briefing file is accepted
    Given a documenter commit that changes only the day's briefing file
    When the guard judges that commit as a tip
    Then it prints DOCUMENTER_BRIEFING_TIP_OK

  # BL-1459 a-tip-outside-the-lane-is-refused-naming-the-path-02
  Scenario Outline: a documenter commit that also changes a path outside the lane is refused naming it
    Given a documenter commit that changes the day's briefing file and <path>
    When the guard judges that commit as a tip
    Then it refuses naming <path>

    Examples:
      | path                       |
      | docs/briefings/.sent.json  |
      | docs/index.md              |
      | extension/src/extension.ts |

  # BL-1459 a-second-briefing-for-a-landed-day-is-refused-03
  Scenario: a briefing for a day the landed main already carries is refused
    Given the landed main already carries the day's briefing file
    And a documenter commit that writes a different version of it
    When the guard judges that commit as a tip
    Then it refuses saying the day's briefing is already on main

  # BL-1459 the-hook-judges-only-a-documenter-side-commit-04
  Scenario: the hook judges only an incoming commit from the documenter branch
    Given a merge whose incoming parent is not reachable from the documenter branch
    When the guard runs in hook mode
    Then it exits 0 without judging

  # BL-1459 the-guard-runs-from-the-shared-chain-05
  Scenario: the guard runs from the shared pre-merge-commit chain
    When the pre-merge-commit hook chain is inspected
    Then it runs the documenter briefing guard beside the art-director guard
