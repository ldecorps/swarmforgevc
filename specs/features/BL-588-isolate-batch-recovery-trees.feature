# mutation-stamp: sha256=3ba6c61ff181e2c8c47b883e4b30d45b62b6cf68905eb1c7784c0557be5c3409
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-26T13:47:35.663887533Z","feature_name":"batch recovery trees are isolated so a clean sibling can land while a defective sibling reworks","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-588-isolate-batch-recovery-trees.feature","background_hash":"437c0b9467f6f396f00ac268aedd59d2c3c8af77b7fc27d25296d3ef4a75b99c","implementation_hash":"unknown","scenarios":[{"index":3,"name":"QA landing refuses history-rewriting operations for a batch sibling","scenario_hash":"c518d59d55c5db6449df42d39a96400bb904bb5c8fcda2434290ba70f86b486e","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-26T13:47:35.663887533Z"}]}
# acceptance-mutation-manifest-end

Feature: batch recovery trees are isolated so a clean sibling can land while a defective sibling reworks

  # BL-588 (approach 3, human_ruling 2026-07-23): BL-532 defers a clean sibling and stops
  # spurious re-queues, but the sibling still cannot LAND while a defective ticket in the
  # same batch commit reworks. Approach 3 cuts the defective ticket's recovery onto a branch
  # from the last clean ancestor, re-forwards each clean sibling's parcel UNCHANGED for
  # whole-tree re-verification, and lets QA land that verified tree — never cherry-picking
  # or rewriting history. BL-532 deferral records name which blocker each clean ticket waits on.

  Background:
    Given a batch commit that satisfies tickets A and B
    And ticket A fails a check on the shared commit
    And ticket B rides the same commit with no failing check of its own
    And ticket B has an open deferral pending ticket A recorded by BL-532

  # BL-588 clean-sibling-re-forward-unchanged-01
  Scenario: a clean sibling parcel is re-forwarded on its original commit after partial batch bounce
    When the batch recovery tooling prepares ticket B for re-forward after ticket A is bounced
    Then ticket B's forward commit is the same commit that satisfied ticket B on the shared batch
    And ticket B's forward is a separate git_handoff from ticket A's recovery

  # BL-588 defective-rework-from-clean-ancestor-02
  Scenario: a defective ticket reworks from the last clean ancestor not the contaminated tip
    When the batch recovery tooling prepares ticket A for rework after QA bounces ticket A
    Then ticket A's recovery branch starts from the last clean ancestor before the shared batch commit
    And ticket A's recovery branch does not include the contaminated batch tip as its base

  # BL-588 clean-sibling-lands-while-blocker-reworks-03
  Scenario: a verified clean sibling can land while the defective sibling still reworks on an isolated branch
    Given ticket B's parcel was re-forwarded unchanged and passed every gate as a whole tree
    And ticket A is still reworking on an isolated recovery branch
    When QA approves ticket B
    Then QA lands ticket B by merging the verified whole tree onto main
    And ticket A's isolated recovery branch is not merged as part of ticket B's landing

  # BL-588 qa-rejects-cherry-pick-landing-04
  Scenario Outline: QA landing refuses history-rewriting operations for a batch sibling
    When QA attempts to land ticket B using <landing operation>
    Then QA is refused with a reason that landing must merge a verified whole tree
    And main is unchanged

    Examples:
      | landing operation        |
      | cherry-pick              |
      | rebase-to-land           |
      | partial-subset cherry-pick |

  # BL-588 merge-up-names-verified-tree-05
  Scenario: a merge-up broadcast for a landed clean sibling names the verified whole-tree commit
    Given ticket B's parcel was re-forwarded unchanged and QA approved it as a whole tree
    When QA broadcasts merge-up for ticket B
    Then the merge-up note names ticket B's verified commit
    And the named commit is an ancestor of the merge-up commit QA landed on main
