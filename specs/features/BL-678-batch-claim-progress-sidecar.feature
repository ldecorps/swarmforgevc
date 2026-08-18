Feature: Batch claim progress sidecar

  Background:
    Given a batch role claims two parcels with injected clock and sidecar paths

  # BL-678 batch-claim-progress-sidecar-01
  Scenario: Claiming a batch parcel writes its sidecar immediately
    When the batch claim completes
    Then each claimed parcel has a sidecar naming the owner role, parcel id, and claim instant

  # BL-678 batch-claim-progress-sidecar-02
  Scenario: Working a batch refreshes the last-progress instant
    Given the batch role makes progress on the first parcel
    Then the first parcel's sidecar last-progress instant is later than its claim instant

  # BL-678 batch-claim-progress-sidecar-03
  Scenario: A chase sweep leaves a fresh-progress parcel alone
    Given a claimed parcel whose sidecar progress is fresher than the staleness threshold
    When the chase sweep runs
    Then the parcel is not re-forwarded, not re-delivered, and not surfaced as suspect

  # BL-678 batch-claim-progress-sidecar-04
  Scenario: A stale-progress parcel is surfaced as suspect, never silently re-delivered
    Given a claimed parcel whose sidecar progress is older than the staleness threshold
    When the chase sweep runs
    Then the coordinator receives a suspect surface line naming the parcel and its progress age
    And the parcel remains claimed in in_process with no copy in inbox new

  # BL-678 batch-claim-progress-sidecar-05
  Scenario: Completing a batch parcel retires its sidecar
    Given the batch role completes the first parcel
    Then the first parcel's sidecar no longer reads as an active claim
