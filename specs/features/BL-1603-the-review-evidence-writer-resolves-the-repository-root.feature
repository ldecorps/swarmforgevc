Feature: BL-1603 The review evidence writer resolves the repository root, and a nested backlog tree never enters a commit

  record-review-evidence.js takes its root from the directory it runs in,
  so a role still in extension/ after the suites gets a real commit of its
  evidence under extension/backlog/evidence/, where no repo-root grep or
  bounce-history read looks; six such files are on main. This feature is
  that the writer resolves the repository top level itself and writes only
  under its backlog/evidence/, that it refuses outside a repository, that
  the orphaned files are where they belong, and (absorbed from BL-1552,
  2026-09-21) that the pre-commit guard chain refuses a staged path whose
  backlog area directory is not at the root, naming the root-relative path
  the role meant.

  Background:
    Given a scratch repository with a backlog/evidence/ directory and an extension/ subdirectory, and a scratch directory inside no git repository

  # BL-1603 evidence-writer-resolves-the-repository-root-01
  Scenario Outline: the writer commits under the repository root whatever directory it runs from, and refuses outside a repository
    When the review evidence writer records a NONE verdict with its working directory set to <cwd>
    Then <outcome>

    Examples:
      | cwd                                   | outcome                                                                                            |
      | the repository root                   | the committed path is backlog/evidence/ plus the evidence file name and nothing exists under extension/backlog |
      | the repository's extension/ subdirectory | the committed path is backlog/evidence/ plus the evidence file name and nothing exists under extension/backlog |
      | the directory inside no repository    | it exits non-zero naming the missing repository and no file was written there                     |

  # BL-1603 evidence-writer-resolves-the-repository-root-02
  Scenario: the orphaned evidence files are at the repository root and the stray directory is gone
    When the tree at the parcel commit is read
    Then git tracks no path under extension/backlog
    And backlog/evidence/ holds BL-1278-hardender-20260909.md, BL-1478-cleaner-20260911.md, BL-1503-cleaner-20260913.md, BL-1558-cleaner-20260915.md and BL-1569-cleaner-20260915.md
    And exactly zero paths in its tree carry a backlog area directory that is not at the root

  # BL-1603 nested-backlog-tree-never-enters-a-commit-03
  Scenario Outline: a staged path under a nested backlog area is refused with the root path named
    Given the commit guard scripts are installed in the scratch repository
    And the path <staged> is staged
    When the pre-commit guard chain runs
    Then the chain refuses the commit naming check_nested_backlog_path.sh
    And the refusal names <root_path> as the path the file belongs at

    Examples:
      | staged                                       | root_path                          |
      | extension/backlog/evidence/BL-1-cleaner-x.md | backlog/evidence/BL-1-cleaner-x.md |
      | swarmforge/backlog/paused/BL-1-y.yaml        | backlog/paused/BL-1-y.yaml         |

  # BL-1603 nested-backlog-tree-never-enters-a-commit-04
  Scenario Outline: a root backlog path or a path that merely contains the word backlog is allowed
    Given the commit guard scripts are installed in the scratch repository
    And the path <staged> is staged
    When the pre-commit guard chain runs
    Then check_nested_backlog_path.sh exits 0 and the chain does not name it

    Examples:
      | staged                                 |
      | backlog/evidence/BL-1-cleaner-x.md     |
      | docs/how-to/backlog-dashboard-notes.md |
      | extension/src/backlog/backlogReader.ts |

  # BL-1603 nested-backlog-tree-never-enters-a-commit-05
  Scenario: the guard runs in the cheap tier and every violation is reported at once
    Given the commit guard scripts are installed in the scratch repository
    And the path extension/backlog/evidence/BL-1-cleaner-x.md is staged
    And a second cheap-tier guard that refuses the same commit
    When the pre-commit guard chain runs
    Then the chain's one refusal names both check_nested_backlog_path.sh and the second guard
