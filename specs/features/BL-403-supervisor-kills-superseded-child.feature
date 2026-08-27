Feature: the front-desk supervisor never runs two bot children at once

  Background:
    Given a front-desk supervisor managing a bot child process

  # BL-403 supervisor-kills-superseded-child-01
  Scenario: restarting an unhealthy bot terminates the prior pid before spawning the replacement
    Given a bot child pid judged unhealthy by the supervisor's liveness check
    When the supervisor acts on the restart decision
    Then it sends SIGTERM (and SIGKILL after a bounded grace timeout) to the prior pid
    And it confirms the prior pid is no longer alive before spawning the replacement

  # BL-403 supervisor-kills-superseded-child-02
  Scenario: the replacement is not spawned while the prior pid is confirmed still alive
    Given a prior bot pid that has not yet exited after termination is requested
    When the supervisor checks whether it may spawn the replacement
    Then it waits rather than spawning a second live bot process

  # BL-403 supervisor-kills-superseded-child-03
  Scenario: status.json reflects exactly one live bot pid after a forced restart
    Given a completed forced restart of the bot child
    When status.json is read after the restart
    Then it records exactly one live bot pid, the replacement's
