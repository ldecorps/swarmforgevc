Feature: BL-1803 swarm stamp - a skipped post-land re-point is retried on a clean tree (hotfix 4183cd29ca)

  Review-only certification (BL-848) of operator hotfix 4183cd29ca, live
  on main since 2026-09-29. A post-land re-point skip used to be the last
  word, so untracked dirt (notably __pycache__/) left swarmforge-QA
  growing without bound. The hotfix arms a pending re-point on every
  skip and retries from done_with_current (QA) via land_step_cli
  try-repoint once the tree is clean. These scenarios drive the real
  helpers and CLI against fixture repositories; they change nothing in
  what landed.

  Background:
    Given a fixture repository whose .swarmforge directory is gitignored and whose origin/main is marked at the current tip

  # BL-1803 swarm-stamp-deferred-land-repoint-on-clean-tree-01
  Scenario: a dirty tip skips the re-point and arms a deferred retry
    Given the tip is ahead of origin/main and the worktree holds an uncommitted change
    When post-land-repoint! runs for landed ticket BL-9001
    Then it skips naming an uncommitted change
    And pending-land-repoint.json names BL-9001 and that reason

  # BL-1803 swarm-stamp-deferred-land-repoint-on-clean-tree-02
  Scenario: try-repoint finishes a prior skip once the tree is clean
    Given a pending re-point was armed because of an uncommitted change on a tip ahead of origin/main
    And that uncommitted change has been removed
    When land_step_cli.bb try-repoint runs
    Then it prints LAND_REPOINTED with the old tip and the new tip
    And the branch tip equals origin/main
    And the pending re-point file is gone

  # BL-1803 swarm-stamp-deferred-land-repoint-on-clean-tree-03
  Scenario: try-repoint is idle when nothing is pending
    Given no pending-land-repoint.json exists
    When land_step_cli.bb try-repoint runs
    Then it prints LAND_REPOINT_IDLE and exits 0
