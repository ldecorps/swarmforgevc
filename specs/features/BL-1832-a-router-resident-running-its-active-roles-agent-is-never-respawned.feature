Feature: BL-1832 a router resident running its active role's agent is never respawned

  Under config rotation router one resident pane, the home role's session,
  hosts whichever role the resident is active as. The babysitter sweep
  judges that pane against the home role's roles.tsv agent alone, so on a
  mixed-agent pack (home "coder" on aider, "QA" on claude) a healthy QA
  rotated into the pane reads as a half-launch and the pane is respawned
  with the home role's launch script. On 2026-09-29 from 00:00Z to 05:00Z
  that killed QA every ten minutes, thirty times, each time mid-land.
  The home pane is healthy when it runs the home role's agent or the
  agent of the role the resident is active as.

  Background:
    Given a pack whose roles.tsv runs role "coder" on agent "aider" and role "QA" on agent "claude"

  # BL-1832 router-resident-active-agent-01
  Scenario Outline: a router home pane running the home agent or the active role's agent is healthy
    Given the pack is a rotation router whose home role is "coder"
    And the resident is active as "<active>"
    And the "coder" pane runs a live "<agent>" process
    When the babysitter sweep assesses the "coder" seat
    Then no half-launch finding names the "coder" seat
    And no repair is decided for the "coder" seat

    Examples:
      | active | agent  |
      | QA     | claude |
      | QA     | aider  |
      | coder  | aider  |

  # BL-1832 router-resident-active-agent-02
  Scenario: a router home pane running no agent process is still a half-launch with a repair
    Given the pack is a rotation router whose home role is "coder"
    And the resident is active as "QA"
    And the "coder" pane runs no agent process
    When the babysitter sweep assesses the "coder" seat
    Then a half-launch CRIT names the "coder" seat
    And a repair to ensure the "coder" session is decided alongside it

  # BL-1832 router-resident-active-agent-03
  Scenario: with no active-role marker the router home pane is judged against the home agent alone
    Given the pack is a rotation router whose home role is "coder"
    And no active-role marker is recorded
    And the "coder" pane runs a live "claude" process
    When the babysitter sweep assesses the "coder" seat
    Then a half-launch CRIT names the "coder" seat

  # BL-1832 router-resident-active-agent-04
  Scenario: a standing pack judges each seat against its own agent even when a marker names another role
    Given the pack is a standing pack
    And an active-role marker names "QA"
    And the "coder" pane runs a live "claude" process
    When the babysitter sweep assesses the "coder" seat
    Then a half-launch CRIT names the "coder" seat
