Feature: test-suite git fixtures never let an inherited GIT_DIR/GIT_WORK_TREE redirect them onto a live repo

  # BL-1196 (epic swarm-reliability). 2026-08-27: coder reported (priority-00
  # note) "property fixture git() leaks GIT_DIR, corrupts main repo". The same
  # morning, the coordinator independently caught the identical failure shape
  # live in its own shell while diagnosing the swarmforge-hardender branch
  # corruption (backlog/evidence/hardener-branch-corruption-20260827.md):
  # GIT_DIR/GIT_WORK_TREE set in the ambient shell silently redirected a
  # `git -C <worktree>` command onto the main checkout instead. Verified by
  # direct inspection: extension/test/helpers/sharedRepoFixture.js's `gitIn`
  # already deletes GIT_DIR/GIT_WORK_TREE before every spawn (BL-1039), but
  # the large majority of test files (extension/test/*.property.test.js and
  # plain *.test.js) define their OWN local, uninstrumented
  # `function git(cwd, args) { execFileSync('git', args, { cwd, ... }) }` with
  # no env override — e.g. bl1106PauseVisibleEverywhere.property.test.js. Any
  # one of these silently obeys an inherited GIT_DIR/GIT_WORK_TREE over its own
  # `cwd`, so whichever real repo/branch/worktree those vars name (not the
  # fixture's temp dir) is what actually receives the write — the same class
  # BL-1124 addressed for property-suite shared-main/core.bare drift, but
  # BL-1124 only detects the damage after a run; it never stopped a spawn
  # already redirected by an inherited ambient var, which is why this
  # recurred after BL-1124 shipped.
  #
  # AMENDED 2026-08-28, after two further occurrences on the hardener branch.
  # The ambient value does not come from a stray operator shell — git exports
  # it into every hook it runs. Measured in an isolated scratch repo: a commit
  # made from a LINKED WORKTREE runs pre-commit with GIT_DIR and
  # GIT_INDEX_FILE both set to absolute paths inside that worktree's gitdir
  # (GIT_WORK_TREE is not set), and check_property_suite_drift.sh passes that
  # environment straight into `npm run test:properties` with no scrubbing. A
  # fixture doing mkdtemp + `git init` + `git commit` under it writes the
  # triggering ROLE's branch ref and clobbers that worktree's index, which is
  # exactly the observed damage. GIT_INDEX_FILE is therefore now in the
  # stripped set, under the original scope's own condition for widening.
  #
  # Fix shape (structural, not a per-file migration): one shared test-setup
  # module strips GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE from process.env once,
  # before any test in a file runs — closing every existing and future local
  # `git()` helper's exposure in one place, the same way BL-1039 already
  # closed it for sharedRepoFixture.js callers specifically — plus the same
  # scrub where the guard script launches the suite, which is the only one of
  # the two that also covers shell fixtures the suite shells out to.

  Background:
    Given the shared git-env guard module is loaded

  # BL-1196 ambient-redirect-vars-stripped-01
  Scenario: Loading the guard strips an inherited git-directory redirect from the process environment
    Given the process environment has GIT_DIR and GIT_WORK_TREE set to some other repository's paths
    When the git-env guard runs
    Then GIT_DIR is no longer set in the process environment
    And GIT_WORK_TREE is no longer set in the process environment

  # BL-1196 fixture-spawn-ignores-ambient-redirect-02
  Scenario: A plain test git() fixture spawn targets its own cwd, not an ambient GIT_DIR redirect
    Given a decoy git repository seeded at one temp path
    And a target git repository seeded at a different temp path
    And the process environment's GIT_DIR points at the decoy repository
    When a test spawns "git rev-parse --show-toplevel" with cwd set to the target repository and no explicit env override
    Then the reported toplevel is the target repository
    And the decoy repository gains no new commits

  # BL-1196 index-redirect-stripped-03
  Scenario: Loading the guard strips an inherited index redirect
    Given the process environment has GIT_INDEX_FILE set to another repository's index path
    When the git-env guard runs
    Then GIT_INDEX_FILE is no longer set in the process environment

  # BL-1196 hook-environment-does-not-reach-fixture-writes-04
  Scenario: A fixture commit made under a worktree hook environment leaves that worktree untouched
    Given a git repository with a linked worktree checked out on its own branch
    And the environment a pre-commit hook receives from a commit in that worktree
    When a fixture creates a temporary directory under that environment and runs "git init" and "git commit" in it
    Then the linked worktree's branch still points at the commit it pointed at before
    And the linked worktree's index is unchanged
