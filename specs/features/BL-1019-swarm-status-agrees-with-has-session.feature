# mutation-stamp: sha256=5fbe7b7e1e9135c28526876afc4c449e939e408287ecd37e4168665cf787cc30
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T12:50:37.918865903Z","feature_name":"swarm status stops reporting DOWN for a role that is demonstrably up","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1019-swarm-status-agrees-with-has-session.feature","background_hash":"605a058cc62b8dab5a87b7996aee89e3f25bbd57d5549a518785761b082e3691","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a shell pane with claude underneath reports UP","scenario_hash":"79ac5c394312ab0379e57d52b113ac5ed84465aa61ba8be1ff27343f6c699a04","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-24T12:42:07.607337217Z"}]}
# acceptance-mutation-manifest-end

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
