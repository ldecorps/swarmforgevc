Feature: BL-1385 A handler that cannot load never reaches main

  Since BL-1371 a step handler registers by existing in specs/pipeline/steps,
  and the registry requires every discovered handler eagerly, failing the
  whole run on one it cannot load. The guards that decide what reaches main
  check that a handler is registered and reachable; none of them loads one.
  So a handler whose require names a module that exists only on an unlanded
  parcel can reach main and make every acceptance run throw. This feature is
  that such a handler is refused by the land replay and by the commit guards,
  naming the handler and the missing module, and that the verdict comes from
  the tree under test and never from the checker's own worktree.

  Background:
    Given a scratch repository whose step registry discovers handlers
    And a good handler on the tree

  # BL-1385 an-unresolvable-handler-is-refused-01
  Scenario Outline: a handler whose require does not resolve on the tree is refused
    Given a handler on the tree requiring <module form> that is absent from the tree
    When the handler module graph guard examines the tree
    Then the guard refuses
    And its output carries the HANDLER_LOAD_BLOCK marker
    And its output names the handler and the missing module

    Examples:
      | module form                               |
      | a compiled extension module under out/    |
      | a sibling helper under lib/               |
      | a relative module beside the handler      |

  # BL-1385 a-resolvable-handler-passes-02
  Scenario: a handler whose require resolves on the tree passes
    Given a handler on the tree requiring a compiled extension module whose source is on the tree
    When the handler module graph guard examines the tree
    Then the guard passes
    And its output omits the HANDLER_LOAD_BLOCK marker

  # BL-1385 the-verdict-comes-from-the-tree-not-the-checker-03
  Scenario Outline: the checker's own worktree never changes the verdict
    Given a handler on the tree requiring a compiled extension module that is <on the tree>
    And the checking worktree has that module <in the checker>
    When the handler module graph guard examines the tree
    Then the guard <verdict>

    Examples:
      | on the tree | in the checker | verdict |
      | absent      | compiled       | refuses |
      | present     | absent         | passes  |

  # BL-1385 the-land-replay-asks-the-question-04
  Scenario: a tip-pure land replay carrying an unresolvable handler is refused
    Given a tip-pure replay whose tree carries a handler requiring a module absent from the tree
    When the land step guards the replayed tree
    Then the land is refused
    And the land output carries the HANDLER_LOAD_BLOCK marker

  # BL-1385 the-commit-guards-ask-the-question-05
  Scenario: the commit guards refuse a hand-land carrying an unresolvable handler
    Given a commit adding a handler requiring a module absent from the tree
    When the commit guards run on that commit
    Then the guard set fails
    And the output carries the HANDLER_LOAD_BLOCK marker
    And every other guard's status is still reported

  # BL-1385 a-tree-the-guard-cannot-open-is-refused-06
  Scenario: a tree the guard cannot examine is refused, never passed
    Given a tree-ish the guard cannot open
    When the handler module graph guard examines the tree
    Then the guard refuses
    And its output says the tree could not be examined
