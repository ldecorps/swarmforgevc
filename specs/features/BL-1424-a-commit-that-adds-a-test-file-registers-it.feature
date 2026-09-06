Feature: A commit that adds a test file registers it

  BL-1240's unregistered-test gate runs at a parcel's git_handoff send, so it
  sees only parcels. A hotfix is a commit made straight onto main, outside
  any parcel - it never sends a handoff - and hotfix 27d6ab8630 added two
  unregistered test files on 2026-09-02 that sat invisible to every gate
  until a coordinator sweep noticed three days later (BL-1423). This feature
  asks BL-1240's exact question - does the file this commit adds have a row
  in the manifest - at every commit instead: check_test_file_registration.sh,
  a new cheap-tier guard in the pre-commit chain (run_commit_guards.sh), so a
  hotfix is caught the moment it is made, not three days later.

  Commit-scoped, not tree-scoped (the load-bearing property, scenario 02):
  the guard judges only what THIS commit's own staged index adds
  (`git diff --cached --diff-filter=A`). Drift an earlier commit already
  left unregistered, or a file merely sitting untracked on disk, is never
  this commit's fault and never refuses it - a tree-wide check would have
  refused every commit in the repository for the three days BL-1423's two
  files sat unregistered. Every scenario runs against its own fixture
  repository under mkdtemp (BL-1390), driving the REAL
  check_test_file_registration.sh - never a reimplementation of its
  decision, which lives in unregistered_test_gate_lib.bb's
  findings-for-staged-commit, the exact function this same file's
  findings-for-git-handoff already uses for BL-1240's own git_handoff path.

  Background:
    Given a fixture repository with a git-initialized main branch and a suite manifest holding one already-registered row

  # BL-1424 staged-test-file-no-row-refused-01
  Scenario Outline: a staged test file with no manifest row is refused, naming the file and the row it needs
    Given the commit adds <file> under the test directory with no manifest row
    When check_test_file_registration.sh runs in that repository
    Then it refuses naming <file> and quoting the row it needs

    Examples:
      | file                  |
      | test_probe.sh         |
      | probe_test_runner.bb  |

  # BL-1424 the-guard-is-silent-02
  Scenario Outline: the guard is silent when the commit's own scope excludes the file
    Given the commit's own staged scope is <work>
    When check_test_file_registration.sh runs in that repository
    Then it exits 0 with no refusal

    Examples:
      | work                                                                          |
      | a staged test file that already has a manifest row                           |
      | an unrelated file, leaving an earlier committed unregistered file untouched   |
      | an unrelated file, leaving an unstaged unregistered file on disk untouched    |
      | a change under docs/ with no test file at all                                |

  # BL-1424 fail-open-on-unreadable-manifest-03
  Scenario: the guard fails open when the staged manifest cannot be read
    Given the repository has no suite manifest at all, staged or committed
    And the commit stages a test file that would otherwise need a row
    When check_test_file_registration.sh runs in that repository
    Then it warns on stderr and exits 0
