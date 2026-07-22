Feature: mono-router resident rotates back to coder home after processing a QA merge-up note

  Background:
    Given the active pack is a mono-router (config rotation router)
    And the home role is coder
    And a QA merge-up note has been broadcast for ticket "BL-529"

  Scenario: non-home role completes merge-up and rotates back to coder
    Given the resident is running as "documenter"
    And the documenter's inbox/in_process holds a QA merge-up note for "BL-529"
    And the documenter has no other pending work
    When the resident merges the QA-approved commit and calls done_with_current.sh
    Then the resident calls rotate_to_role.sh coder
    And the coder's inbox becomes visible to the resident on its next ready_for_next.sh

  Scenario: non-home role with NO_TASK after context clear rotates back to coder
    Given the resident is running as "documenter"
    And the documenter's inbox is empty (no new, no in_process)
    When the resident calls ready_for_next.sh
    Then ready_for_next.sh prints ROTATE_HOME
    And the resident calls rotate_to_role.sh coder

  Scenario: home role (coder) with NO_TASK does not re-rotate to itself
    Given the resident is running as "coder"
    And the coder's inbox is empty
    And the backlog root has no intake files
    When the resident calls ready_for_next.sh
    Then ready_for_next.sh prints NO_TASK
    And the resident does NOT call rotate_to_role.sh

  Scenario: non-home role with pending in_process work does not rotate away
    Given the resident is running as "cleaner"
    And the cleaner's inbox/in_process holds a git_handoff for an active ticket
    When the resident calls ready_for_next.sh
    Then ready_for_next.sh prints TASK with the in_process parcel
    And the resident does NOT call rotate_to_role.sh coder
