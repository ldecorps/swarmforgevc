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
