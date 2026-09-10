Feature: BL-1503 The bl1313 property test copies the closure it computes, never a list

  extension/test/bl1313BatchGuardVisibilityInvariants.property.test.js
  seeds an isolated copy of handoff_lib.bb's and
  duplicate_chain_guard_lib.bb's load-file closure so its bb invocations
  drive committed code immune to mid-run worktree reversion. The copy set
  is eleven file names typed by hand. Hotfix 32fb1ff7e1 (2026-09-09) made
  handoff_lib.bb load-file respawn_bootstrap_lib.bb; the list never gained
  it, so both invariants have died at bb load with FileNotFoundException
  since - the fourth drift of this exact shape (BL-911, BL-967, BL-1029
  before it), which BL-973 answered for shell fixtures with a computed
  closure. This feature is that the test computes the closure from source
  through the helper two sibling property files already use, so a new
  load-file edge is copied the day it lands.

  # BL-1503 property-test-copies-the-computed-closure-01
  Scenario: the property file is green on the tree as it stands
    When extension/test/bl1313BatchGuardVisibilityInvariants.property.test.js runs alone under the properties config
    Then every test in it passes

  # BL-1503 property-test-copies-the-computed-closure-02
  # Census pin (BL-1445): the derived set must be shown to contain the edge
  # that broke it and everything the retired list named, and the file must
  # name only its two entry points as quoted *_lib.bb literals - the handler
  # keys on quoted string literals, so prose naming a lib does not trip it.
  Scenario: the copied set is the computed load-file closure of both entry points
    When the load-file closure of handoff_lib.bb and duplicate_chain_guard_lib.bb is computed from the scripts tree
    Then it contains respawn_bootstrap_lib.bb
    And it contains every one of the eleven files the retired hand list named
    And the property file names only handoff_lib.bb and duplicate_chain_guard_lib.bb as quoted lib literals
