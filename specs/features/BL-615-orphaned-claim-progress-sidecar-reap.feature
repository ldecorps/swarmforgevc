Feature: claim-progress sidecars never outlive their handoff

  # BL-615 orphaned-claim-progress-sidecar-reap-01
  Scenario: completing an in_process handoff removes its claim-progress sidecar
    Given a role's inbox/in_process holds a handoff file paired with its claim-progress sidecar
    When the role completes the handoff with done_with_current.sh
    Then the handoff file moves out of inbox/in_process
    And the paired sidecar is deleted with it

  # BL-615 orphaned-claim-progress-sidecar-reap-02
  Scenario: the sweep reaps a sidecar whose handoff file no longer exists
    Given a role's inbox/in_process holds an orphaned claim-progress sidecar whose handoff file is gone
    When the claim-progress sweep runs
    Then the orphaned sidecar is deleted
    And the reap is logged
