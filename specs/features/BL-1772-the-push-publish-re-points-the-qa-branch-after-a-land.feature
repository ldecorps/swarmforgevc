# mutation-stamp: sha256=14e2cb9df1e1bcce2251950e11b338ef2c06f5a6da06c38a8172964761880711
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-26T06:50:59.168394138Z","feature_name":"BL-1772 The --push publish re-points the QA branch after a land","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1772-the-push-publish-re-points-the-qa-branch-after-a-land.feature","background_hash":"481fe4231a5bad42df5e8ada62cd090ed8be769f97450eacbbdd12179470de75","implementation_hash":"unknown","scenarios":[{"index":1,"name":"a worktree with work in it is left alone and the --push still succeeds","scenario_hash":"24014a450b6e137f5dc4db373b617480ddc2d0828d4bf19b25be367628c909bd","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-26T06:50:59.168394138Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1772 The --push publish re-points the QA branch after a land

  Stamp-off of hotfix db4da5c573 (BL-848). BL-1438 had wired
  post-land-repoint! into land_main_publish.sh --land only. QA's standing
  recipe is --decide-only, a hand-built tip-pure commit, and a publish of
  that SHA - never --land - so the re-point never ran. The hotfix makes
  --push invoke the same verb, and points the QA recipe at --push.

  This feature is that land_main_publish.sh --push, after it has printed
  LAND_PUBLISHED, invokes the same re-point verb --land already runs,
  prints what happened, never lets a skipped re-point fail the publish,
  and never re-points a publish that stopped. Every scenario runs the
  real publish script against a fixture repository with a bare origin
  under a temporary directory, never the live checkout.

  Background:
    Given a fixture repository with a bare origin and a QA-style worktree holding a tip-pure landing commit that --push will publish

  # BL-1772 a-published-push-re-points-a-clean-branch-01
  Scenario: after LAND_PUBLISHED on --push on a clean worktree the branch is re-pointed to origin/main
    Given the QA-style worktree is clean and its in_process mailbox is empty
    When land_main_publish.sh --push publishes the landing commit
    Then it prints LAND_PUBLISHED and then LAND_REPOINTED with the old tip and the new tip
    And the QA-style branch tip equals origin/main
    And the re-point log carries the entry

  # BL-1772 a-skipped-re-point-never-fails-the-push-02
  Scenario Outline: a worktree with work in it is left alone and the --push still succeeds
    Given the QA-style worktree holds <work>
    When land_main_publish.sh --push publishes the landing commit
    Then it prints LAND_PUBLISHED and then LAND_REPOINT_SKIPPED naming <work>
    And it exits 0
    And nothing about the branch or the worktree has moved

    Examples:
      | work                        |
      | an uncommitted change       |
      | a parcel in its in_process  |

  # BL-1772 a-stopped-push-never-re-points-03
  Scenario: a --push that stops before publishing never re-points
    Given the publish step refuses the landing commit
    When land_main_publish.sh --push is run against that commit
    Then it prints LAND_STOPPED and no re-point line
    And the branch was left exactly where the refusal found it
