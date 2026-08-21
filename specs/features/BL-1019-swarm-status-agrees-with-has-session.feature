Feature: swarm status stops reporting DOWN for a role that is demonstrably up

  BL-1019: `./swarm status` reports every agent DOWN while the panes are alive.
  The pane's current command is the shell (pane_current_command=zsh) and claude
  runs as its CHILD, so a check that reads only the pane's own command concludes
  the agent is down. attach's has-session is the honest check. The cost is not
  cosmetic: after an attach miss a human cannot tell "the session is really
  gone" from "status always lies", which is precisely the confusion that made
  the BL-1017 incident hard to read.

  Background:
    Given a pack whose tmux socket is known

  # BL-1019 swarm-status-agrees-with-has-session-01
  Scenario Outline: a shell pane with claude underneath reports UP
    Given role "coder" whose session exists
    And the pane's own command is <pane command>
    And a live claude process runs under that pane
    When status is reported for that role
    Then that role is reported UP

    Examples:
      | pane command |
      | zsh          |
      | bash         |

  # BL-1019 swarm-status-agrees-with-has-session-02
  Scenario: a pane with no claude underneath reports DOWN
    Given role "coder" whose session exists
    And no claude process runs under that pane
    When status is reported for that role
    Then that role is reported DOWN

  # BL-1019 swarm-status-agrees-with-has-session-03
  Scenario: a missing session reports DOWN, agreeing with attach
    Given role "specifier" whose session is missing
    When status is reported for that role
    Then that role is reported DOWN
    And that verdict agrees with what attach reports for the same role

  # BL-1019 swarm-status-agrees-with-has-session-04
  Scenario: an unavailable process check is reported as unknown, never as DOWN
    Given role "coder" whose session exists
    And the process gather for that pane fails
    When status is reported for that role
    Then that role is reported unknown rather than DOWN
