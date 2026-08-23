Feature: a Cursor seat remains observable and recoverable

  Commit f02f6ae5b4 is a human-landed hotfix for a live Cursor full-forge
  run. Before it, the babysitter looked only for a Claude child process, so
  a healthy Cursor pane appeared half-launched; conversely, ensure treated a
  shell-only pane as healthy and could not restore the missing agent. Cursor
  also received a copy of its complete prompt in argv, risking an oversized
  launch command.

  This is a stamp-off of that landed work, not a redesign. It verifies the
  externally observable health, repair, and bootstrap contract before a
  human decides whether to certify the hotfix.

  # BL-1108 cursor-seat-readiness-hotfix-01
  Scenario Outline: live-seat health follows the configured agent
    Given a <agent> role seat with its expected child process <process>
    When the babysitter checks the live seat
    Then the process result is <process result>
    And the remote-control result is <remote-control result>

    Examples:
      | agent  | process        | process result | remote-control result |
      | cursor | cursor-agent   | present        | off                   |
      | claude | claude --model | present        | healthy               |

  # BL-1108 cursor-seat-readiness-hotfix-02
  Scenario: a Cursor pane without its agent is repaired
    Given a Cursor role pane whose cursor-agent child is absent
    When swarm ensure checks that role
    Then it runs the role's persisted launch script
    And it reports the agent repair instead of a healthy seat

  # BL-1108 cursor-seat-readiness-hotfix-03
  Scenario: a Cursor launch refers to its prompt file
    Given a Cursor role with a composed prompt bundle
    When the launcher builds its command
    Then the command tells Cursor to read the prompt file
    And the command does not embed the prompt bundle in its arguments
