Feature: the property-suite guard launches the suite without the hook's git environment

  # BL-1222 (epic swarm-reliability). Split from BL-1196's 2026-08-28
  # amendment. check_property_suite_drift.sh runs the suite as
  # `(cd extension && npm run test:properties)` with no environment handling,
  # and it is invoked from the shared pre-commit hook — an environment git
  # populates itself. Measured in an isolated scratch repo: a commit from a
  # LINKED WORKTREE gives the hook an absolute GIT_DIR and GIT_INDEX_FILE
  # naming that worktree's gitdir (GIT_WORK_TREE is not set, which is why the
  # working tree survives and only the ref and index are hit). A child that
  # cd's outside the repo entirely still resolves to that gitdir. So a fixture
  # doing mkdtemp + git init + git commit writes the branch of the very
  # worktree whose commit triggered the guard — five times in two days across
  # four roles, always on ordinary work.
  #
  # BL-1196 strips the same variables inside vitest and covers every JS test
  # file; the scrub one level out, at this guard's own suite launch, ships
  # with BL-1196 too — its scenario 04 drives this script end to end, so the
  # scrub is load-bearing for that ticket's acceptance and landed with it.
  # What remains here is the coverage BL-1196 does not reach on this script's
  # own surface: the direct assertion on the launched suite's environment, the
  # SHELL fixture a setupFile can never reach (the class that wrote onto local
  # main in BL-1200), and a regression guard that the three short-circuits are
  # unchanged. Scenario 02 was retired 2026-08-28 as superseded by BL-1196
  # scenario 04, which asserts the same worktree-untouched outcome against the
  # real script.

  Background:
    Given the guard is invoked with a git hook environment naming a live worktree

  # BL-1222 suite-launched-without-inherited-git-env-01
  Scenario: The launched suite does not receive the inherited git environment
    When the guard launches the suite
    Then the suite process has no GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE set

  # BL-1222 nested-shell-fixture-also-covered-03
  Scenario: A shell fixture the suite shells out to is covered too
    When the guard launches a suite that shells out to a nested script which creates a repository and commits in it
    Then the triggering worktree's branch still points at the commit it pointed at before

  # BL-1222 short-circuits-unchanged-04
  Scenario Outline: The guard's existing short-circuits are unchanged
    When the guard runs under condition "<condition>"
    Then it exits zero without launching the suite

    Examples:
      | condition                |
      | override variable set    |
      | no triggering path staged |
      | suite toolchain missing  |
