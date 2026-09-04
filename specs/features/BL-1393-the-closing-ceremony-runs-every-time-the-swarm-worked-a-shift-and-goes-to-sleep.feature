Feature: BL-1393 The closing ceremony runs every time the swarm worked a shift and goes to sleep

  Two mechanisms end a shift today. The night ceremony freezes, drains,
  briefs, emails and stops, but only inside an overnight window derived
  from the closure schedule. The lean pass hands the specifier a packet,
  but only when finish-shift is run, and it does none of the rest. A
  weekday bedtime gets the lean pass alone; the full ceremony never runs on
  a weekday. This feature is that there is one ceremony, that the lean pass
  is a named step inside it, that every sleep after at least one shift of
  work runs it whatever path stops the swarm, that a restart never does,
  and that the schedule of shifts is untouched.

  Background:
    Given a swarm fixture with a shift-start stamp newer than the last ceremony
    And an in-flight parcel on the resident

  # BL-1393 a-bedtime-runs-the-whole-ceremony-01
  Scenario: finish-shift after a shift of work runs the one ceremony sequence
    When the swarm is put to sleep through finish-shift
    Then promotion is frozen before anything else
    And the in-flight parcel is drained or parked cleanly
    And the lean packet is delivered to the specifier
    And the briefing is written and its email recorded as sent
    And the swarm is stopped with the bridges kept
    And those steps ran in that order from one sequence

  # BL-1393 the-daemon-trigger-runs-the-same-sequence-02
  Scenario: the closure-window trigger runs the identical sequence including the lean pass
    When the daemon's closure-window gate enters ceremony mode
    Then the lean packet is delivered to the specifier
    And the ceremony trail is identical to the finish-shift trail

  # BL-1393 a-sleep-after-no-work-is-explicit-and-quiet-03
  Scenario: a sleep with no shift of work records an explicit empty outcome and no briefing
    Given no shift-start stamp is newer than the last ceremony
    When the swarm is put to sleep through finish-shift
    Then an explicit empty ceremony outcome is recorded
    And no briefing is sent
    And the swarm is stopped with the bridges kept

  # BL-1393 a-restart-is-not-a-sleep-04
  Scenario Outline: a stop that is a restart runs no ceremony step
    When the swarm is stopped by <restart path>
    Then no ceremony step runs
    And no lean packet is delivered
    And no briefing is sent

    Examples:
      | restart path          |
      | a remote bounce       |
      | an expedite park      |

  # BL-1393 every-sleep-path-fires-it-05
  Scenario Outline: every sleep path fires the ceremony whatever the time of day
    When the swarm is put to sleep through <sleep path> at <local time>
    Then the lean packet is delivered to the specifier
    And the briefing is written and its email recorded as sent

    Examples:
      | sleep path            | local time |
      | a weekday bedtime     | 17:00      |
      | a weekend bedtime     | 09:00      |
      | night-stop            | 06:00      |

  # BL-1393 the-schedule-is-untouched-06
  Scenario: the ceremony never changes which shifts exist
    When the swarm is put to sleep through finish-shift
    Then the crontab is byte-identical to before
    And the shift configuration is byte-identical to before
