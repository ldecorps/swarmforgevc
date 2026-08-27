# mutation-stamp: sha256=de8af9661acd42a0b78c8cc54e13e58f819d8a71dd12a0fd0cfaaeb33f3627df
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-27T20:06:51.051887947Z","feature_name":"a shell test fixture writes to its own temp repository, never to whatever repository an ambient redirect names","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1200-shell-test-fixtures-must-not-inherit-ambient-git-dir-redirect.feature","background_hash":"a51415fe572d692f5c23aa8a71e8aa0508dfe947cbbfd356f61526a8890e4afc","implementation_hash":"unknown","scenarios":[{"index":1,"name":"A suite run under the redirect leaves the live repository's ref state alone","scenario_hash":"d53184f9e15ddd2f1d102950f9b63941a3d66f3aeada46661959e1d772221954","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-27T20:06:51.051887947Z"}]}
# acceptance-mutation-manifest-end

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
