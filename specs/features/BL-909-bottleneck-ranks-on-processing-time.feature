# mutation-stamp: sha256=96351f9fe60c10ee490f6c56e656f53589c8e5789e816d0688f0b7fbd4072bfb
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-19T02:12:27.622272Z","feature_name":"The named bottleneck is the stage that takes longest to do the work, not the stage that waited longest for it","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-909-bottleneck-ranks-on-processing-time.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a stage that waited a long time but worked briefly never outranks a stage that worked longer","scenario_hash":"62df9314a2dc449a0387c303cc68c57cc2c815d0981aff81dc7f6573a26aad75","mutation_count":12,"result":{"Total":12,"Killed":12,"Survived":0,"Errors":0},"tested_at":"2026-08-19T02:12:27.622272Z"},{"index":5,"name":"the per-stage lines still report queue wait alongside processing","scenario_hash":"275b85f8938a56d7a23e493b42a33d7efb1a4947c6b339ca1ffaf203bba38fa1","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-19T02:12:27.622272Z"}]}
# acceptance-mutation-manifest-end

Feature: The named bottleneck is the stage that takes longest to do the work, not the stage that waited longest for it

  # BL-909 (epic BL-594 swarm-behaviour-trends): `nameBottleneck`
  # (extension/src/metrics/stageDwell.ts:208) ranks stages on
  # `stageTotalDwellMs` = median queue wait + median processing. On a mono-router pack
  # queue wait is mailbox time while the single resident is playing another role, so a
  # dormant stage accumulates hours of wait it had no part in. Measured 2026-08-16 over a
  # 24h window: specifier waited 1h51m and processed 1m, and was named the bottleneck at
  # 1.3x — while hardender, at a 25m processing median, was not. The human's ruling: rank
  # on processing time only, and do not paper over it by excluding specifier, because the
  # formula is wrong for every dormant role. The per-stage lines keep showing both figures;
  # only the ranking changes.

  # BL-909 wait-cannot-make-a-stage-the-bottleneck-01
  Scenario Outline: a stage that waited a long time but worked briefly never outranks a stage that worked longer
    Given stage "specifier" waited "<a-wait>" and processed "<a-processing>"
    And stage "hardender" waited "<b-wait>" and processed "<b-processing>"
    When the bottleneck is named
    Then the bottleneck is "hardender"

    Examples:
      | a-wait | a-processing | b-wait | b-processing |
      | 1h51m  | 1m           | 38m    | 25m          |
      | 10h    | 1s           | 0s     | 2s           |
      | 1h51m  | 24m          | 38m    | 25m          |

  # BL-909 the-multiple-is-a-processing-multiple-02
  Scenario: the "Nx the next slowest" multiple compares processing medians
    Given stage "hardender" waited "38m" and processed "25m"
    And stage "QA" waited "43m" and processed "14m"
    When the bottleneck is named
    Then the bottleneck is "hardender"
    And the multiple over the next slowest stage is computed from processing medians

  # BL-909 the-reported-line-names-the-processing-ranked-stage-03
  Scenario: the Bottleneck line reports the processing-ranked stage and its processing multiple
    Given stage "specifier" waited "1h51m" and processed "1m"
    And stage "hardender" waited "38m" and processed "25m"
    When the stage dwell report is rendered
    Then the Bottleneck line names "hardender"
    And the Bottleneck line does not name "specifier"

  # BL-909 a-stage-that-did-no-work-is-not-ranked-04
  Scenario: a stage that processed no parcel this window is not a bottleneck candidate
    Given stage "documenter" processed no parcel this window
    And stage "hardender" waited "38m" and processed "25m"
    When the bottleneck is named
    Then the bottleneck is "hardender"
    And "documenter" is not a bottleneck candidate

  # BL-909 no-work-anywhere-still-answers-honestly-05
  Scenario: with no stage having processed anything the report still declines to name one
    Given no stage processed a parcel this window
    When the stage dwell report is rendered
    Then the Bottleneck line reports that no stage processed a parcel this window

  # BL-909 per-stage-lines-keep-both-figures-06
  Scenario Outline: the per-stage lines still report queue wait alongside processing
    Given stage "specifier" waited "1h51m" and processed "1m"
    When the stage dwell report is rendered
    Then the line for "specifier" reports a "<measure>" median of "<value>"

    Examples:
      | measure    | value |
      | wait       | 1h51m |
      | processing | 1m    |
