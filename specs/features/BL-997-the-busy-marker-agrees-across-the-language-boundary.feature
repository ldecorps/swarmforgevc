# mutation-stamp: sha256=c2456dc6667ffa0157636035aecce50ea407f0c774b75ff6c215d7c565e61be2
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-21T07:10:38.968590Z","feature_name":"The busy marker agrees across the language boundary","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-997-the-busy-marker-agrees-across-the-language-boundary.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"Both sides reach the same verdict on the same pane","scenario_hash":"e8a15e30707ffb716f2e26f0e0fed7e37b9765765610b57c262b92d1970dfd13","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-21T07:10:38.968590Z"}]}
# acceptance-mutation-manifest-end

Feature: The busy marker agrees across the language boundary

  The swarm classifies a mid-turn pane in Babashka; the extension host
  classifies the same pane in TypeScript, in its own process, where no import
  can reach a .bb lib. Today both spell the marker the same way and nothing
  asserts that they do - only comments on each side say so.

  The engineering rules already require a test for exactly this shape: a
  constant mirrored by hand across a boundary no import can bridge needs a
  test asserting both literals agree, because a "kept in sync" comment is not
  a gate and drift fails silently.

  The drift is not hypothetical. The Babashka side is being changed right
  now, and nothing would tell the TypeScript side.

  # BL-997 both-sides-agree-01
  Scenario Outline: Both sides reach the same verdict on the same pane
    Given the shared pane fixture <fixture>
    When the swarm classifier and the extension-host classifier each classify it
    Then both return the same verdict

    Examples:
      | fixture                     |
      | a live turn-status frame    |
      | an idle prompt              |
      | an idle prompt quoting the marker |

  # BL-997 drift-is-caught-and-named-02
  Scenario: A definition changed on one side alone fails the check
    Given the swarm-side busy definition no longer matches the extension-host one
    When the agreement check runs
    Then the check fails
    And the failure names both literals

  # BL-997 a-mid-turn-pane-is-never-respawned-03
  Scenario: The extension host never respawns a pane that is mid-turn
    Given the shared pane fixture a live turn-status frame
    When the extension host runs its respawn precheck
    Then the respawn is refused
