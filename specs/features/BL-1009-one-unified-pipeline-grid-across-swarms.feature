# mutation-stamp: sha256=fb48fec72913e4da5200d20da1e7f984ecc7b507c6336b0a57827b07d4b30887
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T14:18:24.558664100Z","feature_name":"One pipeline grid across every swarm, badged by owner","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1009-one-unified-pipeline-grid-across-swarms.feature","background_hash":"29dbf3ca3270fffe5e4d755d3bdefde98a3b45a9b3d3fc92290cb1c970136a49","implementation_hash":"unknown","scenarios":[{"index":1,"name":"each caption names the swarm that owns its ticket","scenario_hash":"56b6d760718570df7f101f94a4a11a932997eb67af48d1d3b7ca32d6e3878d66","mutation_count":9,"result":{"Total":9,"Killed":9,"Survived":0,"Errors":0},"tested_at":"2026-08-24T14:18:24.558664100Z"}]}
# acceptance-mutation-manifest-end

Feature: One pipeline grid across every swarm, badged by owner

  The pipeline board is mono-swarm today: its rows are exactly
  backlog/active/ membership and its stage markers come from this host's own
  live mailboxes. The shared git backlog already carries a per-ticket
  `swarm:` field (BL-090), so a ticket owned by swarm2 is already visible in
  the same folders — it just renders with no indication of who owns it.

  These scenarios put every swarm's tickets on ONE grid and make ownership
  visible per ticket. The operator's words: "Prefer this over 'two grids on
  one topic.'"

  Live held-by-role state for a REMOTE swarm is deliberately out of scope
  here — this host cannot observe another host's mailboxes, and scenario 05
  pins that an unobservable stage renders as absent rather than guessed. A
  cross-host stage signal is a later slice of the pipeline-board epic.

  Background:
    Given the local swarm is named "primary"

  # BL-1009 unified-swarm-grid-01
  Scenario: tickets from two swarms share one grid
    Given an active ticket "BL-801" assigned to swarm "primary"
    And an active ticket "BL-802" assigned to swarm "second"
    When the pipeline board is rendered
    Then the grid has a column for "BL-801"
    And the grid has a column for "BL-802"

  # BL-1009 unified-swarm-grid-02
  Scenario Outline: each caption names the swarm that owns its ticket
    Given an active ticket "BL-801" assigned to swarm "primary"
    And an active ticket "BL-802" assigned to swarm "second"
    And an active ticket <ticket> assigned to swarm <assigned>
    When the pipeline board is rendered
    Then the caption for <ticket> carries the swarm badge <badge>

    Examples:
      | ticket | assigned | badge |
      | BL-803 | primary  | s1    |
      | BL-804 | second   | s2    |
      | BL-805 | third    | third |

  # BL-1009 unified-swarm-grid-03
  Scenario: a ticket with no swarm field is badged as the primary swarm
    Given an active ticket "BL-801" with no swarm field
    And an active ticket "BL-802" assigned to swarm "second"
    When the pipeline board is rendered
    Then the caption for "BL-801" carries the swarm badge "s1"

  # BL-1009 unified-swarm-grid-04
  Scenario: a board holding one swarm's tickets renders no swarm badge
    Given an active ticket "BL-801" assigned to swarm "primary"
    And an active ticket "BL-802" with no swarm field
    When the pipeline board is rendered
    Then no caption carries a swarm badge

  # BL-1009 unified-swarm-grid-05
  Scenario: a remote swarm's ticket shows no live held-by-role marker
    Given an active ticket "BL-801" assigned to swarm "primary" held by role "coder"
    And an active ticket "BL-802" assigned to swarm "second" held by role "coder"
    When the pipeline board is rendered
    Then the grid marks "BL-801" as held at stage "coder"
    And the grid marks no stage as holding "BL-802"

  # BL-1009 unified-swarm-grid-06
  Scenario: badges never cost a visible grid column
    Given an active ticket "BL-801" assigned to swarm "primary"
    And an active ticket "BL-802" assigned to swarm "second"
    When the pipeline board is rendered
    Then the number of visible grid columns is the same as with no badges
