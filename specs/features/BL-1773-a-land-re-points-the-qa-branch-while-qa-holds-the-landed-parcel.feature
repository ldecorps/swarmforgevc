Feature: BL-1773 A land re-points the QA branch while QA holds the landed parcel

  After every land the publish re-points QA's branch to origin/main
  (BL-1438 for --land, BL-1772 for --push), so the next land walks only
  what is new. The re-point refuses to reset a tree that might hold work,
  and one of its guards is "a parcel in its in_process". QA lands while
  the parcel it is landing is still in its in_process, so from QA's own
  worktree the re-point has skipped on every land it was asked for
  (land-repoint.log: 2026-09-22 four times, 2026-09-24 once, always "a
  parcel in its in_process"). The parcel being landed is not unfinished
  work the reset could destroy; its content just published. Any other
  in-process parcel still is.

  Background:
    Given a fixture repository with an origin whose main is ahead of a QA-shaped worktree branch
    And the QA-shaped worktree's tree is clean

  # BL-1773 the-landed-tickets-own-parcel-does-not-block-the-re-point-01
  Scenario: the re-point proceeds when the only in-process parcel is the landed ticket's own
    Given the worktree's in_process holds a git_handoff whose task names the landed ticket
    When the post-land re-point runs for the landed ticket
    Then it prints LAND_REPOINTED and the branch tip equals origin/main

  # BL-1773 any-other-in-process-work-still-blocks-the-re-point-02
  Scenario Outline: the re-point still skips when the in-process parcel is not the landed ticket's own
    Given the worktree's in_process holds <parcel>
    When the post-land re-point runs for the landed ticket
    Then it prints LAND_REPOINT_SKIPPED naming the in_process parcel
    And the branch tip has not moved

    Examples:
      | parcel                                              |
      | a git_handoff whose task names a different ticket   |
      | a note that names no ticket                         |
      | the landed ticket's git_handoff and a second parcel |
