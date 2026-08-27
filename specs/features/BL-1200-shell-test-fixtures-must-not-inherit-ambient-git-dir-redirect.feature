Feature: a shell test fixture writes to its own temp repository, never to whatever repository an ambient redirect names

  # BL-1200 (epic swarm-reliability). 2026-08-27 19:31 BST: the shell half of
  # BL-1196's defect, caught in the act. swarmforge/scripts/test/
  # expedite_fixture.sh runs `git init -q -b main .` and `git config
  # user.name "expedite fixture"` with no GIT_DIR/GIT_WORK_TREE clearing.
  # Run from an agent pane where both vars are ambient — they are, in every
  # pane, and no swarm launcher exports them — GIT_DIR overrides the
  # fixture's own cwd and `git -C`, so the writes land on the live
  # repository. Twenty commits authored "expedite fixture" reached local
  # main, the master checkout was left on a detached HEAD, and `main` ended
  # up claimed by a stray /tmp worktree. Evidence: backlog/evidence/
  # master-checkout-detached-by-expedite-fixture-20260827.md. Measured the
  # same day: 332 shell tests under swarmforge/scripts/test/, 75 of them run
  # git, and 0 clear either variable.

  Background:
    Given GIT_DIR and GIT_WORK_TREE are set in the environment and name a live repository

  # BL-1200 fixture-writes-to-its-own-repo-not-the-redirect-01
  Scenario: A shell fixture's git writes land in the fixture's own temp repository
    When a shell test fixture creates its temp repository and commits to it
    Then the commit is in the fixture's temp repository
    And the live repository named by the redirect gains no commit

  # BL-1200 live-repo-ref-state-untouched-by-a-suite-run-02
  Scenario Outline: A suite run under the redirect leaves the live repository's ref state alone
    Given the live repository's <ref> is recorded before the run
    When the standing shell suite is run under the redirect
    Then the live repository's <ref> is unchanged

    Examples:
      | ref            |
      | HEAD           |
      | current branch |
