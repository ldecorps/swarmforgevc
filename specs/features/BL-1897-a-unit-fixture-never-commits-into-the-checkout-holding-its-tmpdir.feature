Feature: BL-1897 A unit-test fixture never commits into the checkout that holds its TMPDIR

  The workflow rule puts temporary files under ./tmp in the role's own
  worktree. On 2026-10-02 QA ran the unit lane for BL-1867 with TMPDIR at
  ./tmp/BL-1867-tmpdir. The target-bootstrap tests in config.test.js make
  their "non-git directory" fixtures under TMPDIR, and the bootstrap's git
  check reads any subdirectory of a work tree as a repository. So the
  fixtures committed into QA's live branch: 16 commits between 10:50 and
  10:52. BL-1834's land replayed them, and 29 fixture files are tracked
  under tmp/ on main. A fixture dir is now never part of the checkout that
  holds it, and nothing is tracked under tmp/.

  # BL-1897 bootstrap-tests-leave-the-checkout-alone-01
  Scenario: the bootstrap tests pass and leave the checkout's history unchanged
    Given a scratch git checkout made by git init under mkdtemp, with TMPDIR set to a directory inside it
    When test/config.test.js runs with that TMPDIR
    Then every test in it passes
    And the scratch checkout's HEAD and commit count are what they were before the run

  # BL-1897 nothing-is-tracked-under-tmp-02
  Scenario: the repository tracks no path under tmp/
    When the repository's tracked paths are listed
    Then none of them is under tmp/
