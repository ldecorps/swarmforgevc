Feature: BL-1277 no step file answers another feature's steps by accident

  specs/pipeline/stepRegistry.js resolves an UNSCOPED registration by
  first-match across every handler file. So when two step files register the
  same pattern with registry.define, whichever happens to load first answers
  that step text for BOTH features, and the loser's scenarios silently run
  the winner's handler against the winner's fixture. BL-425 added
  registry.defineScoped precisely so a file can pin generic step text to its
  own feature, and BL-800 used it to unshadow one such collision in 2026-08;
  nothing yet refuses the next unscoped duplicate, so the class stays open
  and silent. This feature adds that refusal and clears the collisions
  already present.

  # BL-1277 unscoped-step-pattern-collision-01
  Scenario Outline: a repeated step text collides only while the later registration is unscoped
    Given a step file registers the step text "the widget is ready" unscoped
    And a second step file registers the step text "<second text>" <scoping>
    When the step-file collision guard runs
    Then the guard <verdict>

    Examples:
      | second text         | scoping                   | verdict |
      | the widget is ready | unscoped                  | refuses |
      | the widget is ready | scoped to its own feature | passes  |
      | the widget is idle  | unscoped                  | passes  |

  # BL-1277 unscoped-step-pattern-collision-02
  Scenario: a refusal names the step text and every file that registers it
    Given three step files each register the step text "the widget is ready" unscoped
    When the step-file collision guard runs
    Then the guard refuses
    And the refusal names the step text "the widget is ready"
    And the refusal names all three step files

  # BL-1277 unscoped-step-pattern-collision-03
  Scenario: the shipped step registry has no unscoped collision left
    Given the step files this repository actually ships
    When the step-file collision guard runs
    Then the guard passes
