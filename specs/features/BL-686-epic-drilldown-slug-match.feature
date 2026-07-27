Feature: Epic drill-down resolves epic membership by slug

  Background:
    Given epic ticket "BL-545" declares epic slug "swarm-intelligence-layer" with priority 5
    And epic ticket "BL-517" declares epic slug "swarmforge-console" with priority 6
    And live topic "BL-590" declares epic slug "swarm-intelligence-layer" with priority 20
    And live topic "BL-624" declares epic slug "swarm-intelligence-layer" with priority 30
    And live topic "BL-660" declares epic slug "swarmforge-console" with priority 10

  # BL-686 epic-drilldown-slug-match-01
  Scenario Outline: Drilling into an epic lists the live topics declaring its slug, though the tile id is not that slug
    When the "<epicTicketId>" tile is drilled into
    Then the drill-down lists exactly "<topics>"

    Examples:
      | epicTicketId | topics        |
      | BL-545       | BL-590,BL-624 |
      | BL-517       | BL-660        |

  # BL-686 epic-drilldown-slug-match-02
  Scenario: An epic tracker is never a peer in one of its own topics' make-top comparison
    When the make-top button on row "BL-624" is tapped in the "BL-545" drill-down
    Then epic ticket "BL-545" keeps its priority

  # BL-686 epic-drilldown-slug-match-03
  Scenario: Make-top from the drill-down is accepted by the topic route and re-renders the new order
    When the make-top button on row "BL-624" is tapped in the "BL-545" drill-down
    Then the topic make-top route answers success
    And the drill-down lists exactly "BL-624,BL-590"

  # BL-686 epic-drilldown-slug-match-04
  Scenario: Make-top ranks a topic above its own epic's topics only, never another epic's
    When the make-top button on row "BL-624" is tapped in the "BL-545" drill-down
    Then live topic "BL-660" keeps its priority

  # BL-686 epic-drilldown-slug-match-05
  Scenario: Two epic trackers declaring the same slug drill down to the same topics
    Given epic ticket "BL-542" declares epic slug "swarm-intelligence-layer" with priority 7
    When the "BL-542" tile is drilled into
    Then the drill-down lists exactly "BL-590,BL-624"
