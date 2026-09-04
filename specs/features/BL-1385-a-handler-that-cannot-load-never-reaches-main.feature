# mutation-stamp: sha256=5ce053fd2642a9efc1ea562103abf7d13422c051bad89b6594539468fc8c2f64
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-04T14:24:51.654473310Z","feature_name":"BL-1385 A handler that cannot load never reaches main","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1385-a-handler-that-cannot-load-never-reaches-main.feature","background_hash":"cb1755a47e3456b4b6c8a6c4b9d87c8889e4ee82ca55cffbc9d1d3492f92136f","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a handler whose require does not resolve on the tree is refused","scenario_hash":"9b0ed1886ce7909ad4be31516fc49b314e52754f4944e1f143fd066ef0172889","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-04T11:15:55.584348589Z"},{"index":2,"name":"the checker's own worktree never changes the verdict","scenario_hash":"a200edf1572050f7fea01a2f9d487d03f429197e849b18042368540c2b811ab9","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-09-04T11:15:55.584348589Z"}]}
# acceptance-mutation-manifest-end

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

  # BL-1385 a-tree-with-nothing-to-discover-passes-07
  Scenario: a tree with no step registry directory at all passes
    Given a tree with no step registry directory at all
    When the handler module graph guard examines the tree
    Then the guard passes
    And its output omits the HANDLER_LOAD_BLOCK marker

  # BL-1385 a-handler-calling-exit-does-not-hide-a-later-bad-one-08
  Scenario: a handler calling process.exit at load does not hide a later bad handler
    Given a handler on the tree calling process.exit before a bad handler requiring a module absent from the tree
    When the handler module graph guard examines the tree
    Then the guard refuses
    And its output names the handler and the missing module

  # BL-1385 a-foreign-absolute-path-is-not-tree-content-09
  Scenario: a handler requiring a foreign absolute path outside any tree passes
    Given a handler on the tree requiring a nonexistent absolute path outside any tree
    When the handler module graph guard examines the tree
    Then the guard passes
    And its output omits the HANDLER_LOAD_BLOCK marker

  # BL-1385 concurrent-invocations-do-not-interfere-10
  Scenario: two invocations running at once each reach their own verdict
    Given a handler on the tree requiring a compiled extension module whose source is on the tree
    When two handler module graph guards examine the tree at the same time
    Then both guards pass
    And neither guard removed a working directory it did not create
