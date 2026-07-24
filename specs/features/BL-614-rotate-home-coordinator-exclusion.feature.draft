Feature: mono-router rotate-home never fires for the coordinator

  Background:
    Given the active pack is a mono-router (config rotation router)
    And the home role is coder

  # BL-614 rotate-home-coordinator-exclusion-01
  Scenario: coordinator with an empty mailbox gets NO_TASK, not ROTATE_HOME
    Given the calling role is "coordinator"
    And the coordinator's inbox is empty (no new, no in_process)
    When the coordinator calls ready_for_next.sh
    Then ready_for_next.sh prints NO_TASK
    And rotate_to_role.sh is not invoked

  # BL-614 rotate-home-coordinator-exclusion-02
  Scenario: coordinator whose in_process holds only orphaned claim-progress sidecars still gets NO_TASK
    Given the calling role is "coordinator"
    And the coordinator's inbox/in_process holds only .claim-progress.json sidecars with no matching handoff file
    When the coordinator calls ready_for_next.sh
    Then ready_for_next.sh prints NO_TASK
    And rotate_to_role.sh is not invoked
