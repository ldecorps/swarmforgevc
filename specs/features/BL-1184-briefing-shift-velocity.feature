# mutation-stamp: sha256=6a36746557d63c2520bcf27ef3c2606e1d119fb319156077699ca4c66db97cd6
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-27T17:46:43.716671826Z","feature_name":"briefing shift velocity plots tickets landed per eight-hour stretch","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1184-briefing-shift-velocity.feature","background_hash":"30b11da3fb854d0736e831663b91a636e5e0def15aebde7b62eac10e92c8abc3","implementation_hash":"unknown","scenarios":[{"index":4,"name":"forward capture uses telemetry when required","scenario_hash":"b8a5f311bade2dee0a182012cc3adb0446f55210264ec17974b98cb8b72aedac","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-27T17:36:46.320239894Z"}]}
# acceptance-mutation-manifest-end

Feature: briefing shift velocity plots tickets landed per eight-hour stretch

  # BL-1184 (epic BL-594 family). Count done/ closes in 8 consecutive hours;
  # max rolling 8h per calendar day; git and/or telemetry; non-linear time axis.

  Background:
    Given backlog close events are available from git history or telemetry

  # BL-1184 eight-hour-landed-count-01
  Scenario: an eight-hour window reports how many tickets landed
    Given three tickets closed inside an eight-hour window and one outside it
    When shift velocity is computed for that window
    Then the landed count is three

  # BL-1184 daily-max-rolling-window-02
  Scenario: each calendar day reports the max landed count over rolling eight-hour windows
    Given close events spanning one calendar day with uneven bursts
    When the daily shift-velocity series is aggregated
    Then each day carries the maximum eight-hour landed count for that day

  # BL-1184 git-history-without-second-reader-03
  Scenario: historical points derive from the existing git lifecycle adapter
    Given backlog git history with done closes across many days
    When shift velocity history is built
    Then closes come from the existing lifecycle or deliveryMetrics adapter
    And no second backlog history reader is introduced

  # BL-1184 non-linear-time-axis-04
  Scenario: the briefing chart uses a non-linear time axis with recent precision
    Given a shift-velocity series spanning long history
    When the briefing chart is rendered
    Then the time axis is not linear equal spacing for the full history
    And recent points are shown with more precision than older points

  # BL-1184 telemetry-forward-or-reuse-05
  Scenario Outline: forward capture uses telemetry when required
    Given <telemetry_state>
    When shift velocity recording is configured
    Then <outcome>

    Examples:
      | telemetry_state                         | outcome                                      |
      | no existing landed-window telemetry     | an append-only shift-velocity log is created |
      | an existing matching telemetry series   | that series is reused without a duplicate    |
