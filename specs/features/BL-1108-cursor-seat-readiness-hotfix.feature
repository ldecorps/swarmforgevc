# mutation-stamp: sha256=939bd50b20bf38a984cc00b1a91519a3a28c16f98912e3c5d931a23637906df0
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-23T21:21:08.295955585Z","feature_name":"a Cursor seat remains observable and recoverable","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1108-cursor-seat-readiness-hotfix.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"live-seat health follows the configured agent","scenario_hash":"431039638acc716b89f1959a8efb356b751df21870180e48c8d37fcf2289cc3e","mutation_count":8,"result":{"Total":8,"Killed":8,"Survived":0,"Errors":0},"tested_at":"2026-08-23T21:21:08.295955585Z"}]}
# acceptance-mutation-manifest-end

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
