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
  # Fix shape (structural, not a per-file migration): one shared test-setup
  # module strips GIT_DIR/GIT_WORK_TREE from process.env once, before any test
  # in a file runs — closing every existing and future local `git()` helper's
  # exposure in one place, the same way BL-1039 already closed it for
  # sharedRepoFixture.js callers specifically.

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
