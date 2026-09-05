# mutation-stamp: sha256=07b503a3a17451ea69b777c557da14414c596186832ea606cf188f6301e7da4c
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T01:55:21.859826112Z","feature_name":"BL-1400 The registration guard sees a nested handler","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1400-the-registration-guard-never-sees-a-nested-handler.feature","background_hash":"c398dbd12b74e7b48c3c86bb67ffae45d6ad962541bd3c3ba629f7449c8b0032","implementation_hash":"unknown","scenarios":[{"index":2,"name":"a helper under lib is never reported as an unregistered handler","scenario_hash":"d36b8295ed11aa42938df7796ac413149d0601445e605ab1d5af8fbd2962b2ad","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-05T01:55:21.859826112Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1400 The registration guard sees a nested handler

  The registration guard promises to refuse a handler placed where discovery
  cannot reach it, and its predicate rejects a subdirectory placement. But
  the tree it examines lists the steps directory flat, so a nested handler
  never enters the tree and a feature whose only handler is nested passes.
  This feature is that a nested handler is seen and refused as unregistered,
  and that legitimate nested helpers are not turned into offenders.

  Background:
    Given a scratch tree with a feature file for ticket "BL-9009"

  # BL-1400 a-nested-handler-is-refused-01
  Scenario: a feature whose only handler is nested is refused naming both
    Given the feature's only handler sits in a subdirectory of the steps directory
    When the registration guard examines the tree
    Then the guard refuses
    And its output names the nested handler and the feature

  # BL-1400 a-top-level-handler-passes-02
  Scenario: the same handler at the top of the steps directory passes
    Given the feature's only handler sits at the top of the steps directory
    When the registration guard examines the tree
    Then the guard passes

  # BL-1400 nested-helpers-are-not-offenders-03
  Scenario Outline: a helper under lib is never reported as an unregistered handler
    Given a helper under the steps lib directory that <relation>
    And the feature's only handler sits at the top of the steps directory
    When the registration guard examines the tree
    Then the guard passes

    Examples:
      | relation                                   |
      | a top-level handler requires               |
      | no handler requires                        |

  # BL-1400 the-live-tree-gains-no-offender-04
  Scenario: the guard against the live tree reports no new offender
    When the registration guard examines the live tree
    Then the guard passes
