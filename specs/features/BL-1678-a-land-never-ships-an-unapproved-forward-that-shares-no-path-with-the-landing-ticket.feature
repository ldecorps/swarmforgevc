Feature: BL-1678 A land never ships an unapproved forward that shares no path with the landing ticket

  QA lands by pushing its branch tip as main after the land step reads
  the tip, and the land step's sibling check covers only siblings that
  share a path with the landing ticket, so a forward QA merged and has not
  approved rides to main unreviewed whenever it touches other paths -
  BL-1640's bounced forward reached origin/main under BL-1666's land on
  2026-09-21. This feature is that every unlanded forward on the tip is
  judged, that a land is always a tip-pure commit of the landing ticket's
  own paths, and that the publish step refuses a merge commit or a foreign
  path as main.

  Background:
    Given a fixture origin whose QA branch merged an approved ticket A and an unapproved ticket B forward on disjoint paths

  # BL-1678 an-unapproved-forward-on-other-paths-is-judged-01
  Scenario: the land step names the unapproved forward and plans a tip-pure replay instead of a clean push
    When the land step plans A's land on that tip
    Then it names B as an unapproved forward
    And it plans a replay whose diff against main names only A's paths

  # BL-1678 a-land-is-always-a-tip-pure-commit-02
  Scenario: landing A puts one single-parent commit on main and none of B's paths
    When A is landed through the publish step
    Then the fixture origin's main gains exactly one commit with one parent whose subject is A's landing subject
    And none of B's paths exist on main

  # BL-1678 the-publish-step-refuses-a-branch-tip-03
  Scenario Outline: the publish step refuses to push a commit that is not a tip-pure land
    When the publish step is asked to push <commit> as main
    Then it refuses naming <reason>

    Examples:
      | commit                                        | reason                                   |
      | the QA branch's merge tip                     | a merge commit is never pushed as main   |
      | a single-parent commit that also carries B's path | B's path attributed to the unapproved B  |
