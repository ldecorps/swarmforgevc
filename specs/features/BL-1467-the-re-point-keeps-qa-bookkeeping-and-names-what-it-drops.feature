Feature: BL-1467 The post-land re-point keeps QA's bookkeeping for other tickets and names every commit it drops

  BL-1438's re-point moves the QA branch and worktree to origin/main after
  every land, guarded by a clean worktree and no in_process parcel. Those
  guards see uncommitted work; they do not see committed, local-only work:
  a bounce's evidence file and bounce_history record for another ticket,
  the BL-490/495 revert of the bounced merge, a follow-up finding. On
  2026-09-07 the re-point after BL-1447's land dropped BL-1450's bounce
  revert and the evidence commits on it; they survived only in the reflog
  and on the coder's branch. A re-point keeps bookkeeping commits for
  tickets other than the one just landed by re-applying them on the new
  tip, drops the rest, and names every dropped commit; a revert is dropped
  and named, never re-applied, because on a tree that never had the
  bounced content it has nothing to revert. Every scenario runs against a
  fixture repository under mkdtemp with its own origin (BL-1390).

  Background:
    Given a fixture repository whose QA branch is ahead of origin/main after a land, with a clean worktree and no in_process parcel

  # BL-1467 a-bookkeeping-commit-for-another-ticket-survives-the-re-point-01
  Scenario Outline: a bookkeeping commit for a ticket other than the landed one survives the re-point
    Given a local-only commit touching only <path> for a ticket other than the landed one
    When the re-point runs
    Then the branch is re-pointed to origin/main
    And that commit's content is present on the new tip

    Examples:
      | path                                        |
      | backlog/evidence/BL-9002-bounce-20260907.md |
      | backlog/active/BL-9002-x.yaml               |

  # BL-1467 every-dropped-commit-is-named-02
  Scenario: every dropped commit is named
    Given local-only commits that are neither bookkeeping for another ticket nor part of the land
    When the re-point runs
    Then the re-point log and the publish output name each dropped commit by sha and subject

  # BL-1467 a-bounce-revert-is-dropped-and-named-never-re-applied-03
  Scenario: a bounce revert is dropped and named, never re-applied
    Given a local-only revert commit of a bounced merge
    When the re-point runs
    Then the revert is named as dropped
    And the new tip equals origin/main on every path the revert touched

  # BL-1467 a-conflicting-re-application-is-dropped-and-named-04
  Scenario: a bookkeeping commit that does not apply cleanly is dropped, named, and leaves no conflict behind
    Given a local-only bookkeeping commit for another ticket whose file origin/main changed differently
    When the re-point runs
    Then the commit is named as dropped with the conflict as its reason
    And the worktree is clean at origin/main plus the commits that did apply

  # BL-1467 the-existing-guards-and-the-never-fail-promise-stand-05
  Scenario: the existing guards and the never-fail promise are unchanged
    Given an uncommitted change in the worktree
    When the re-point runs
    Then it is skipped with the existing reason and the land is unaffected
