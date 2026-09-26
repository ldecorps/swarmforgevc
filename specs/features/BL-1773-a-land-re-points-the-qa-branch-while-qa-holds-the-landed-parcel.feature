# mutation-stamp: sha256=2b8056914226f61f3f3dfb6caaa7a6c9038d759106f51f32dc1d7827dd4cdbfc
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-26T05:32:30.629612477Z","feature_name":"BL-1773 A land re-points the QA branch while QA holds the landed parcel","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1773-a-land-re-points-the-qa-branch-while-qa-holds-the-landed-parcel.feature","background_hash":"f092c20d82f52295c9d748f2d44574f32410312634487a315a340f32bc4c62f6","implementation_hash":"unknown","scenarios":[{"index":1,"name":"the re-point still skips when the in-process parcel is not the landed ticket's own","scenario_hash":"03c0489857623ccdd266b52cc2a2a093467658f7a53bad491697de3beca9e513","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-26T05:32:30.629612477Z"}]}
# acceptance-mutation-manifest-end

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
      | the landed ticket's git_handoff and a claim-progress sidecar named for a different parcel |

  # BL-1773 the-landed-parcels-own-sidecar-does-not-block-the-re-point-03
  Scenario: the re-point proceeds when the landed ticket's parcel carries its own claim-progress sidecar
    Given the worktree's in_process holds a git_handoff whose task names the landed ticket
    And the worktree's in_process holds that parcel's claim-progress sidecar
    When the post-land re-point runs for the landed ticket
    Then it prints LAND_REPOINTED and the branch tip equals origin/main
