Feature: Role dwell counts occupied time, not the sum of parcel windows

  # BL-923 (lean-aware-coordinator). A parcel's stage-transition exit event
  # carries processingMs = completed_at - dequeued_at, which is correct per
  # parcel. computeDwellHotspots then SUMS those per-parcel windows into a
  # per-role total, which is only valid if the role handled its parcels one
  # after another. The two batch roles (cleaner, hardender) dequeue and
  # complete several parcels in ONE window, so that window is counted once
  # per parcel and their dwell totals are inflated. This feature pins dwell
  # to the time a role was actually occupied.
  #
  # Step handlers: specs/pipeline/steps/bl923DwellCountsOccupiedTimeSteps.js,
  # driving closingCeremony.ts against fixture ledger events. The <expected>
  # column is validated against explicit KNOWN_VALUES, never passed through.

  Background:
    Given a shift ledger whose stage-transition events each carry one parcel's occupancy window at a role

  # BL-923 dwell-is-occupied-time-01
  Scenario Outline: dwell counts the time the role was occupied
    Given a role whose parcel windows are <layout>
    When the coordinator builds the closing packet
    Then that role's dwell total is <expected>

    Examples:
      | layout                             | expected                       |
      | two parcels sharing one window     | that one window's duration     |
      | three parcels sharing one window   | that one window's duration     |
      | two parcels in disjoint windows    | the sum of both windows        |
      | two parcels in overlapping windows | the span they jointly occupied |

  # BL-923 hypothesis-ranks-real-occupancy-02
  Scenario: the dwell hypothesis names the busiest role by occupied time
    Given a shift where a batch role's summed parcel windows exceed a serial role's total but its occupied time does not
    When the coordinator builds the closing packet
    Then the dwell hotspots rank roles by occupied time
    And the dwell-derived hypothesis names the serial role
