# mutation-stamp: sha256=ca1dd2cebd6a19f6b14de44ba6da2c83fabf782711e71596a92f9239ec796016
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-30T06:36:49.623852575Z","feature_name":"A sibling whose work is already landed is not reported as entangled","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1272-a-landed-sibling-is-not-reported-as-entangled.feature","background_hash":"9c84335f2c6d0d0d0d1fa7de90aeb368d169fbfe92e4ade13f8be27d33ed6b03","implementation_hash":"unknown","scenarios":[{"index":0,"name":"A sibling is reported as entangled only on positive evidence it is unlanded","scenario_hash":"3aba2411cf9946655428fe8e18bfd1d2c08925e3cf3c888bba101ab67a81cf28","mutation_count":8,"result":{"Total":8,"Killed":8,"Survived":0,"Errors":0},"tested_at":"2026-08-30T06:36:49.623852575Z"}]}
# acceptance-mutation-manifest-end

Feature: A sibling whose work is already landed is not reported as entangled
  The land step's entanglement check walks the cited commit's own ancestry and
  names every commit whose subject belongs to a different ticket. A tip-pure
  replay lands as a NEW commit object built on the then-current origin/main, so
  landing a sibling's replay does not remove that sibling's ORIGINAL commit from
  the ancestry of the next parcel cited at the same original tip.

  The consequence is a false-stale signal, not a lost commit: the replay content
  stays correct, but the report handed to a human names a sibling as still
  entangled when it has in fact already landed - sending whoever reads it to
  adjudicate an entanglement that no longer exists.

  Correcting the report must not loosen the check itself. A sibling counts as
  landed only on positive evidence that its attributed content is already on
  origin/main, and the land step's own action for a given commit is unchanged.

  Background:
    Given the land step is examining a commit approved for its own ticket
    And a sibling ticket's commit is an ancestor of that commit

  # BL-1272 landed-sibling-naming-01
  Scenario Outline: A sibling is reported as entangled only on positive evidence it is unlanded
    Given the sibling's attributed content is <sibling state> on origin/main
    When the land step reports the commit's entangled siblings
    Then the sibling is <reported> as entangled

    Examples:
      | sibling state          | reported     |
      | byte-identical         | not reported |
      | absent                 | reported     |
      | partially present      | reported     |
      | unreadable             | reported     |

  # BL-1272 landed-sibling-naming-02
  Scenario: An already-landed sibling is still accounted for in the report
    Given the sibling's attributed content is byte-identical on origin/main
    When the land step reports the commit's entangled siblings
    Then the report identifies the sibling as already landed

  # BL-1272 landed-sibling-naming-03
  Scenario: The land step's action is unchanged when every ancestor sibling has landed
    Given every sibling ticket in the commit's ancestry has already landed
    When the land step decides what to do with the commit
    Then it decides the same action it decided before those siblings landed
    And the commit is not landed as cited
