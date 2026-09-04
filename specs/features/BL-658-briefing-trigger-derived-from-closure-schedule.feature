# mutation-stamp: sha256=a5ee3406dba4114e290dec3e8e9a8239113139cd3853ae5c18130bb014ad71fe
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-26T10:17:09.984565826Z","feature_name":"The closing ceremony ends the night with the briefing, and the briefing ends the night","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-658-briefing-trigger-derived-from-closure-schedule.feature","background_hash":"9804a24507b7cc159b669a460d9ec1605ac7b718d066fb8af75d0cb6d168780d","implementation_hash":"unknown","scenarios":[{"index":4,"name":"Moving the closure schedule moves the ceremony, with no second clock to edit","scenario_hash":"97e24cbd21b772ae352ed4bf3a6f2a6a49ac4a5ccce9dc81f9fe3d6895f44589","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-26T10:17:09.984565826Z"},{"index":5,"name":"A swarm with no usable closure schedule keeps today's fixed-time briefing trigger","scenario_hash":"a3cd5c65597cc03e3f2e1938c0468e6fc56e1cbab71f292252ca8e66e3173121","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-26T10:17:09.984565826Z"}]}
# acceptance-mutation-manifest-end

Feature: The closing ceremony ends the shift with the briefing, and the briefing ends the shift

  BL-1393 re-tensed this narrative (the ticket's `retires:` scope exemption):
  the sequence below is no longer the NIGHT's alone. It runs on every sleep
  after at least one shift of work - a weekday bedtime through finish-shift,
  night-stop, or the daemon's own closure-window trigger - and the BL-820 lean
  pass is one of its steps rather than a second mechanism beside it. Every
  scenario here still holds: they describe the sequence, and the scheduled
  trigger is still one of the callers.

  Background:
    Given a closing-ceremony fixture whose closure schedule stops the swarm at "06:00"
    And a drain budget of 25 minutes and a briefing budget of 10 minutes

  # BL-658 closing-ceremony-01
  Scenario: Nominal night - the parcel drains, the resident rotates to the documenter, then everything stops
    Given the resident is "coder" holding an in-flight parcel
    And that parcel's stage completes within the drain budget
    When the closing ceremony runs
    Then the recorded closing sequence is "freeze-promotion, parcel-drained, rotate-documenter, briefing-committed, send-confirmed, swarm-stopped"
    And no parcel was delivered after the freeze
    And the send confirmation came from the briefing sent-state, not from the briefing file existing
    And zero claims remain in in_process across all mailboxes

  # BL-658 closing-ceremony-02
  Scenario: Happy-days branch - a parcel that drains at the documenter chains into the briefing with no rotation
    Given the resident is "documenter" holding an in-flight parcel
    And that parcel's stage completes within the drain budget
    When the closing ceremony runs
    Then the recorded closing sequence is "freeze-promotion, parcel-drained, briefing-committed, send-confirmed, swarm-stopped"
    And no rotation was requested
    And zero claims remain in in_process across all mailboxes

  # BL-658 closing-ceremony-03
  Scenario: A parcel that outruns the drain budget is parked cleanly and the night still ends on time
    Given the resident is "coder" holding an in-flight parcel
    And that parcel's stage is still running when the drain budget expires
    When the closing ceremony runs
    Then the parcel is parked with its claim intact
    And the parked parcel is surfaced loudly as "closing-drain-deadline-exceeded"
    And the recorded closing sequence is "freeze-promotion, parcel-parked, rotate-documenter, briefing-committed, send-confirmed, swarm-stopped"
    And the swarm is stopped no later than "06:00"

  # BL-658 closing-ceremony-04
  Scenario: A briefing that never lands is surfaced loudly and the hard deadline stops the swarm anyway
    Given no parcel is in flight when the ceremony begins
    And the documenter never commits the briefing
    When the closing ceremony runs
    Then the swarm is stopped at the hard deadline "06:00"
    And the missing briefing is surfaced loudly as "closing-briefing-missing"
    And no briefing send is recorded for that night
    And the recorded closing sequence is "freeze-promotion, rotate-documenter, briefing-missing, swarm-stopped"

  # BL-658 closing-ceremony-05
  Scenario Outline: Moving the closure schedule moves the ceremony, with no second clock to edit
    Given the closure schedule is moved to stop the swarm at "<closureTime>"
    When the ceremony begin time is resolved
    Then the ceremony begins at "<ceremonyBeginTime>"
    And the fixed-time briefing trigger is never consulted

    Examples:
      | closureTime | ceremonyBeginTime |
      | 06:00       | 05:25             |
      | 07:00       | 06:25             |
      | 01:00       | 00:25             |

  # BL-658 closing-ceremony-06
  Scenario Outline: A swarm with no usable closure schedule keeps today's fixed-time briefing trigger
    Given the fixture's closure schedule is replaced with "<scheduleState>"
    When the ceremony sweep runs at the fixed briefing time
    Then no closing ceremony is begun
    And the swarm is not stopped
    And the fixed-time briefing trigger fires exactly as it does today
    And the resolver surfaces "<surfaced>"

    Examples:
      | scheduleState | surfaced                   |
      | absent        | nothing                    |
      | ambiguous     | closure-schedule-ambiguous |

  # BL-658 closing-ceremony-07
  Scenario: A night whose briefing is already recorded as sent is never sent a second time
    Given no parcel is in flight when the ceremony begins
    And the briefing for that night is already recorded as sent
    When the closing ceremony runs
    Then exactly one send is recorded for that night
    And no rotation was requested
    And the recorded closing sequence is "freeze-promotion, briefing-already-sent, swarm-stopped"

  # BL-658 closing-ceremony-08
  Scenario: The ceremony records its own window so held parcels are not later read as stalled
    Given the resident is "coder" holding an in-flight parcel
    And a second parcel is held in its inbox by the promotion freeze
    When the closing ceremony runs
    Then a could-not-process window spanning the whole ceremony is recorded
    And the held parcel is named in that window
