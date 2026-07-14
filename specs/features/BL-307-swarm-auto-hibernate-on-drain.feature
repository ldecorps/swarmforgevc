Feature: The swarm auto-hibernates when fully drained and auto-relaunches when new work arrives

  # BL-307 swarm-auto-hibernate-01
  Scenario: hibernates when no promotable work remains and every role in the current roster is idle
    Given no promotable backlog work remains
    And every role in the current roster has an empty inbox and no in-process task
    When the runtime evaluates the closing pass
    Then it hibernates the swarm

  # BL-307 swarm-auto-hibernate-02
  Scenario: a role still holding an in-process task blocks hibernation
    Given no promotable backlog work remains
    And a role in the current roster holds an in-process task
    When the runtime evaluates the closing pass
    Then it does not hibernate

  # BL-307 swarm-auto-hibernate-03
  Scenario: a pending inbox item blocks hibernation
    Given no promotable backlog work remains
    And a role in the current roster has a pending item in its inbox
    When the runtime evaluates the closing pass
    Then it does not hibernate

  # BL-307 swarm-auto-hibernate-04
  Scenario: a blocked paused ticket never blocks hibernation
    Given the only backlog/paused item is blocked and not currently promotable
    And every role in the current roster has an empty inbox and no in-process task
    When the runtime evaluates the closing pass
    Then it hibernates the swarm

  # BL-307 swarm-auto-hibernate-05
  Scenario: a role absent from the current roster is trivially quiescent
    Given the current roster does not include the documenter role
    And every role in the current roster has an empty inbox and no in-process task
    And no promotable backlog work remains
    When the runtime evaluates the closing pass
    Then it hibernates the swarm

  # BL-307 swarm-auto-hibernate-06
  Scenario: hibernating parks the swarm using the already-proven sequence
    When the runtime hibernates
    Then the current roster is backed up and then emptied
    And the build-agent tmux sessions are killed on the swarm socket
    And handoffd, the runtime itself, and the front-desk bot are left running
    And the hibernation is recorded in the runtime's status output

  # BL-307 swarm-auto-hibernate-07
  Scenario: new promotable work arriving while hibernated triggers an automatic relaunch
    Given the swarm is hibernated
    When new promotable work arrives
    Then the runtime relaunches the swarm
    And the backed-up roster is restored
    And the hibernation state is cleared
