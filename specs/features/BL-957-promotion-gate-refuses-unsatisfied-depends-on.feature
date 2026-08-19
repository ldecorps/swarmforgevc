Feature: Promotion refuses a ticket whose declared dependency has not landed

  Tickets in backlog/paused/ and backlog/hold/ may declare depends_on ids.
  promote_and_route_next.sh routes every promotion — by-name and auto-pick
  alike — through the promotion_gates chokepoint, which already decides
  human_approval, Article 3.2.4 expedite ordering, active_backlog_max_depth,
  orthogonality and the hold marker. It has never read depends_on, so a
  dependent ticket can reach the coder before the work it depends on has
  landed. This feature adds that gate to the same chokepoint, so both
  invocation modes inherit it.

  Background:
    Given a backlog whose promotions are decided by the promotion_gates chokepoint
    And ticket "BL-700" is in "backlog/done/"

  # BL-957 depends-on-promotion-gate-01
  Scenario: A named promotion whose dependency has not landed is refused
    Given paused ticket "BL-955" declares depends_on "BL-620"
    And ticket "BL-620" is in "backlog/active/"
    When the coordinator promotes "BL-955" by name
    Then promotion is refused naming gate "depends_on"
    And the refusal names dependency "BL-620"
    And "BL-955" is still in "backlog/paused/"

  # BL-957 depends-on-promotion-gate-02
  Scenario: Auto-pick skips a dependency-blocked candidate rather than stalling
    Given paused ticket "BL-955" declares depends_on "BL-620"
    And ticket "BL-620" is in "backlog/active/"
    And paused ticket "BL-960" declares depends_on "BL-700"
    When the coordinator promotes without naming a ticket
    Then "BL-960" is promoted to "backlog/active/"
    And "BL-955" is still in "backlog/paused/"

  # BL-957 depends-on-promotion-gate-03
  Scenario Outline: A dependency counts as satisfied only once it has landed in done
    Given paused ticket "BL-955" declares depends_on "BL-333"
    And ticket "BL-333" is in "<dependency location>"
    When the coordinator promotes "BL-955" by name
    Then the promotion gate answers "<verdict>"

    Examples:
      | dependency location | verdict |
      | backlog/done/       | ALLOW   |
      | backlog/done/M7/    | ALLOW   |
      | backlog/active/     | REFUSE  |
      | backlog/paused/     | REFUSE  |
      | backlog/hold/       | REFUSE  |
      | no folder at all    | REFUSE  |

  # BL-957 depends-on-promotion-gate-04
  Scenario Outline: A ticket declaring no dependency is unaffected by the gate
    Given paused ticket "BL-960" whose depends_on field is "<field form>"
    When the coordinator promotes "BL-960" by name
    Then the promotion gate answers "ALLOW"

    Examples:
      | field form |
      | []         |
      | omitted    |

  # BL-957 depends-on-promotion-gate-05
  Scenario: A refusal names every unsatisfied dependency and no satisfied one
    Given paused ticket "BL-604" declares depends_on "BL-700, BL-620, BL-948"
    And ticket "BL-620" is in "backlog/active/"
    And ticket "BL-948" is in "backlog/paused/"
    When the coordinator promotes "BL-604" by name
    Then promotion is refused naming gate "depends_on"
    And the refusal names dependency "BL-620"
    And the refusal names dependency "BL-948"
    And the refusal does not name dependency "BL-700"

  # BL-957 depends-on-promotion-gate-06
  Scenario Outline: Dependency ids are read from every single-line depends_on form the backlog uses
    Given paused ticket "BL-955" whose depends_on field is "<depends_on value>"
    And every dependency it names is in "backlog/active/"
    When the coordinator promotes "BL-955" by name
    Then the refusal names exactly the dependencies "<ids read>"

    Examples:
      | depends_on value                      | ids read       |
      | [BL-620]                              | BL-620         |
      | [BL-620, BL-948]                      | BL-620, BL-948 |
      | BL-620, BL-948 (both must land first) | BL-620, BL-948 |

  # BL-957 depends-on-promotion-gate-07
  Scenario: A block-style depends_on list is read, never silently treated as absent
    Given paused ticket "BL-557" declares depends_on as a block list of "BL-547" and "BL-556"
    And ticket "BL-547" is in "backlog/active/"
    And ticket "BL-556" is in "backlog/paused/"
    When the coordinator promotes "BL-557" by name
    Then promotion is refused naming gate "depends_on"
    And the refusal names dependency "BL-547"
    And the refusal names dependency "BL-556"
