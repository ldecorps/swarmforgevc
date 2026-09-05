Feature: BL-1438 The publish re-points the QA branch after a land

  BL-1432 ruled both halves of the land-walk fix. The bounded walk went
  live by default: land-plan computes the parcel's own base when none is
  given, and land_step_cli.bb gives none. The re-point did not:
  post-land-repoint! sits in land_step_lib.bb, unit- and
  acceptance-tested, refusing a dirty tree or a parcel in process and
  logging every outcome, and nothing calls it. QA found this at its own
  land of BL-1432 and approved the parcel, since its feature tested the
  function directly, then routed the gap here. The ticket's own wiring
  anchors named only the step handler, the exact mistake its author warns
  every other ticket against. Until something calls the re-point, QA's
  branch keeps growing by a few commits per land.

  This feature is that land_main_publish.sh, the script QA runs for every
  land, invokes the re-point once and only once a land has published,
  prints what happened, never lets a skipped re-point fail the land, and
  never re-points a land that stopped. Every scenario runs the real
  publish script against a fixture repository with a bare origin under a
  temporary directory, never the live checkout.

  Background:
    Given a fixture repository with a bare origin and a QA-style worktree holding an approved parcel that lands clean

  # BL-1438 a-published-land-re-points-a-clean-branch-01
  Scenario: after LAND_PUBLISHED on a clean worktree the branch is re-pointed to origin/main
    Given the QA-style worktree is clean and its in_process mailbox is empty
    When land_main_publish.sh lands the parcel
    Then it prints LAND_PUBLISHED and then LAND_REPOINTED with the old tip and the new tip
    And the QA-style branch tip equals origin/main
    And the re-point log carries the entry

  # BL-1438 a-skipped-re-point-never-fails-the-land-02
  Scenario Outline: a worktree with work in it is left alone and the land still succeeds
    Given the QA-style worktree holds <work>
    When land_main_publish.sh lands the parcel
    Then it prints LAND_PUBLISHED and then LAND_REPOINT_SKIPPED naming <work>
    And it exits 0
    And nothing about the branch or the worktree has moved

    Examples:
      | work                        |
      | an uncommitted change       |
      | a parcel in its in_process  |

  # BL-1438 a-stopped-land-never-re-points-03
  Scenario: a land that stops before publishing never re-points
    Given the land step escalates for the parcel
    When the publish is run against that escalating parcel
    Then it prints LAND_STOPPED and no re-point line
    And the branch was left exactly where the escalation found it
