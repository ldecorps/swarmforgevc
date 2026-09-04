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
