Feature: BL-1603 The review evidence writer resolves the repository root

  record-review-evidence.js takes its root from the directory it runs in,
  so a role still in extension/ after the suites gets a real commit of its
  evidence under extension/backlog/evidence/, where no repo-root grep or
  bounce-history read looks; six such files are on main. This feature is
  that the writer resolves the repository top level itself and writes only
  under its backlog/evidence/, that it refuses outside a repository, and
  that the orphaned files are where they belong.

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
