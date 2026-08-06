# mutation-stamp: sha256=11a0cc9cedf486e47db764021502494f8e9e076f05f17e022bb80c12da2580b2
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-06T14:37:49.354317Z","feature_name":"Append-only swarm availability interval ledger","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-823-availability-interval-ledger.feature","background_hash":"0d5874f786e0486f7d54772958ef2eb363f49d893d6b556d59797658e8e6a3ae","implementation_hash":"unknown","scenarios":[{"index":0,"name":"Every pause writer twin appends its transition","scenario_hash":"118b81f258c5df87806892fd019fb715ed54a760149b27d53df33826b54028b4","mutation_count":12,"result":{"Total":12,"Killed":12,"Survived":0,"Errors":0},"tested_at":"2026-08-06T14:37:40.715245Z"},{"index":4,"name":"A ledger write failure never blocks the operation it observes","scenario_hash":"5624b47861704249626f7a310278bc2c4e861065e8f64ebdb7a5e59f82d7d0eb","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-06T14:37:40.715245Z"}]}
# acceptance-mutation-manifest-end

Feature: Append-only swarm availability interval ledger

  Two of the three interval classes BL-650 needs to subtract have no durable
  record today: control/cooldown pauses (a current-state marker that resume
  overwrites) and stop-to-start gaps (a stop writes nothing at all). This
  ledger records both as append-only transition records and folds them into
  intervals carrying explicit provenance.

  It records and exposes. It never subtracts, and it changes no alarm.

  Background:
    Given a project root whose availability ledger is empty

  # BL-823 availability-interval-ledger-01
  Scenario Outline: Every pause writer twin appends its transition
    When the <writer> pause writer sets active to <active>
    Then the ledger's last record has event "<event>" and class "control-pause"
    And that record names its source

    Examples:
      | writer   | active | event       |
      | control  | true   | pause-start |
      | control  | false  | pause-end   |
      | operator | true   | pause-start |
      | operator | false  | pause-end   |

  # BL-823 availability-interval-ledger-02
  Scenario: A graceful stop and the next start fold into one proven interval
    Given a "stop" record at "2026-08-06T01:00:00Z"
    And a "start" record at "2026-08-06T02:00:00Z"
    When the ledger is folded into intervals
    Then there is one "swarm-stop" interval of 60 minutes with provenance "proven"

  # BL-823 availability-interval-ledger-03
  Scenario: An ungraceful stop is closed at the daemon's last heartbeat
    Given a "start" record at "2026-08-06T00:00:00Z"
    And no "stop" record was written
    And the handoffd heartbeat file last ticked at "2026-08-06T01:00:00Z"
    When the swarm starts at "2026-08-06T02:00:00Z"
    Then a synthetic "stop" record is appended at "2026-08-06T01:00:00Z"
    And there is one "swarm-stop" interval of 60 minutes with provenance "inferred"

  # BL-823 availability-interval-ledger-04
  Scenario: An ungraceful stop with no heartbeat evidence emits no interval
    Given a "start" record at "2026-08-06T00:00:00Z"
    And no "stop" record was written
    And no handoffd heartbeat file exists
    When the swarm starts at "2026-08-06T02:00:00Z"
    Then no "swarm-stop" interval is emitted for that gap

  # BL-823 availability-interval-ledger-05
  Scenario Outline: A ledger write failure never blocks the operation it observes
    Given the ledger file cannot be written
    When a <operation> runs
    Then it completes normally
    And it raises no error to its caller

    Examples:
      | operation      |
      | control pause  |
      | swarm stop     |
      | swarm start    |

  # BL-823 availability-interval-ledger-06
  Scenario: A corrupt ledger line is skipped without discarding its neighbours
    Given a "stop" record at "2026-08-06T01:00:00Z"
    And a corrupt line
    And a "start" record at "2026-08-06T02:00:00Z"
    When the ledger is folded into intervals
    Then there is one "swarm-stop" interval of 60 minutes with provenance "proven"

  # BL-823 availability-interval-ledger-07
  Scenario: A pause with no matching resume is emitted as an open interval
    Given a "pause-start" record at "2026-08-06T01:00:00Z"
    And no matching "pause-end" record
    When the ledger is folded into intervals
    Then there is one open "control-pause" interval starting at "2026-08-06T01:00:00Z"
    And it has no end timestamp

  # BL-823 availability-interval-ledger-08
  Scenario: An interval spanning a month boundary folds across both ledger files
    Given a "stop" record at "2026-08-31T23:00:00Z" in the "2026-08" ledger
    And a "start" record at "2026-09-01T01:00:00Z" in the "2026-09" ledger
    When the ledger is folded into intervals
    Then there is one "swarm-stop" interval of 120 minutes with provenance "proven"
