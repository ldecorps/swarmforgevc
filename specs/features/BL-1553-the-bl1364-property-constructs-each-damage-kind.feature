# mutation-stamp: sha256=2023cb53637c163f423d5710f5bb59ac0238ad1f38bb1b2e8edca49e1751c9f1
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-14T06:50:18.510023935Z","feature_name":"BL-1553 The bl1364 property constructs each damage kind","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1553-the-bl1364-property-constructs-each-damage-kind.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":2,"name":"the reach floor for each damage kind is still asserted in the test source","scenario_hash":"aae438d90c5d2ed9bff7f229edcbd0ff8efcdadad769c815fe5569ad8e74c145","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-14T06:50:18.510023935Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1553 The bl1364 property constructs each damage kind

  extension/test/bl1364TurnProfileSeriesInvariants.property.test.js asserts
  that invariant 2 generated interior damage, a missing transcript and an
  unreadable path at least once each, but the damage kind is only sampled
  from fc.integer 0..2 over 15 draws, so about one run in ten never draws
  one kind and the file is red on main with nothing wrong in the producer
  it exercises. This feature is that the damage kind is iterated by the
  test, the way BL-1533 iterates the delta sign, so the floors are met by
  construction on every run and stay asserted at their values.

  # BL-1553 constructs-each-damage-kind-01
  Scenario: the property file is green on the tree as it stands
    When extension/test/bl1364TurnProfileSeriesInvariants.property.test.js runs alone under the properties config
    Then every test in it passes

  # BL-1553 constructs-each-damage-kind-02
  Scenario: invariant 2 reports reaching every damage-kind floor from the run itself
    When extension/test/bl1364TurnProfileSeriesInvariants.property.test.js runs alone under the properties config
    Then the run prints a reach map for invariant 2
    And that reach map counts interior, missing and unreadablePath at least once each
    And the three counts in that reach map sum to at least 15

  # BL-1553 constructs-each-damage-kind-03
  Scenario Outline: the reach floor for each damage kind is still asserted in the test source
    When the source of extension/test/bl1364TurnProfileSeriesInvariants.property.test.js is read
    Then it still asserts that <kind> was generated at least once

    Examples:
      | kind           |
      | interior       |
      | missing        |
      | unreadablePath |
