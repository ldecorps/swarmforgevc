# mutation-stamp: sha256=cec6648e1be0797957fea3bce5536cbcc53746b87f5f1b9d587f5b35cbae8682
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-26T15:55:54.931614255Z","feature_name":"Three named shift packs — one active shift drives every schedule-derived clock","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-660-three-shift-packs-conf-selectable.feature","background_hash":"346e218113713fc27a4f191134f8cb65c126b354f1e7b642d82db0c0db38d062","implementation_hash":"unknown","scenarios":[{"index":3,"name":"the evening shift that spans midnight starts and stops on the correct calendar days","scenario_hash":"0c0fc1d9731eb5009ac322278f7e4671d8babe3e2def52c48533b699f9103a6f","mutation_count":9,"result":{"Total":9,"Killed":9,"Survived":0,"Errors":0},"tested_at":"2026-08-26T14:19:59.815456307Z"},{"index":5,"name":"any single active shift keeps the stopped gap under Telegram getUpdates retention","scenario_hash":"6874d8487d6665eaa40633f83c8f6be4a1f4d6661d216da0fc0d499b088401f3","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-26T14:19:59.815456307Z"}]}
# acceptance-mutation-manifest-end

Feature: Three named shift packs — one active shift drives every schedule-derived clock

  # BL-660, operator 2026-07-26: "les 3 huits" — day 09:00-17:00, evening
  # 17:00-01:00, night 01:00-09:00. Exactly ONE shift active at a time via:
  #
  #   config swarm_shift day|evening|night
  #
  # Absent/blank → 24/7 semantics, byte-identical to today's disabled-window
  # behaviour. When a shift IS active it is the ONLY schedule source:
  #
  #   - Start/stop crontab lines are RENDERED by a deterministic applier
  #     (idempotent, diffs before write, surfaces human-edited lines it did
  #     not render — never clobbers).
  #   - BL-617 cooldown window becomes the INVERSE of the active shift
  #     (pause outside working hours) — cooldown_start/end and
  #     cooldown_window_enabled are derived, not independently edited.
  #   - BL-658 closure_stop_local IS the shift end; ceremony begin derives
  #     from it (BL-658 already consumes closure_stop_local — this ticket
  #     supplies the source).
  #   - Briefing fires via the ceremony (last act) or shift-end minus margin
  #     until BL-658 lands on the path.
  #
  # Provider-outage intervals (BL-650 signature-backed only) EXTEND the
  # shift close so a shift aims at 8 EFFECTIVE hours, capped and never
  # crossing the next shift boundary; swarm-caused downtime NEVER credits.
  # Boundaries are LOCAL wall-clock (cron semantics); DST one-hour anomalies
  # twice a year are accepted, not engineered around.

  Background:
    Given a swarm project with a controllable local clock
    And a crontab fixture managed by the shift schedule applier

  # BL-660 night-shift-single-source-01
  Scenario: night shift active derives start, stop, and pause from one conf line
    Given swarm_shift is set to "night"
    When the shift schedule is resolved
    Then the scheduled swarm start is "01:00" local
    And the scheduled swarm stop is "09:00" local
    And closure_stop_local is derived as "09:00" local
    And the cooldown pause window is derived as "09:00" to "01:00" local
    And no other schedule constant needs editing for those times

  # BL-660 switch-day-to-evening-02
  Scenario: switching day to evening before the next cycle uses the new shift only
    Given swarm_shift was "day" and is changed to "evening" while the swarm is stopped
    When the shift schedule applier reconciles crontab
    Then the next scheduled start is "17:00" local
    And the next scheduled stop is "01:00" local on the following calendar day
    And no stale start or stop line from the day shift remains armed

  # BL-660 absent-shift-24x7-03
  Scenario: absent swarm_shift keeps today's disabled-window 24/7 semantics
    Given swarm_shift is absent from swarmforge.conf
    And the cooldown window is disabled as it is today
    When the shift schedule is resolved
    Then no shift-derived start or stop crontab lines are rendered
    And the cooldown decision matches today's disabled-window behaviour exactly
    And closure_stop_local behaviour matches today's absent-or-manual path

  # BL-660 evening-spans-midnight-04
  Scenario Outline: the evening shift that spans midnight starts and stops on the correct calendar days
    Given swarm_shift is set to "evening"
    When the shift schedule is resolved for local time "<anchor>"
    Then the scheduled swarm start calendar day is "<start_day>"
    And the scheduled swarm stop calendar day is "<stop_day>"
    And the scheduled swarm start time is "17:00" local
    And the scheduled swarm stop time is "01:00" local

    Examples:
      | anchor           | start_day | stop_day  |
      | Monday 16:30     | Monday    | Tuesday   |
      | Monday 23:00     | Monday    | Tuesday   |
      | Tuesday 00:30    | Monday    | Tuesday   |

  # BL-660 manual-start-outside-shift-05
  Scenario: a human manual start outside the active shift is left alone
    Given swarm_shift is set to "day"
    And the current local time is "20:00" outside the day shift
    When a human starts the swarm manually for backlog drain
    Then the swarm is not paused by shift machinery
    And the swarm is not killed by shift machinery
    And the swarm is not immediately re-scheduled by shift machinery
    When the next scheduled shift boundary arrives
    Then the normal scheduled machinery applies from that boundary onward

  # BL-660 offline-approvals-gap-06
  Scenario Outline: any single active shift keeps the stopped gap under Telegram getUpdates retention
    Given swarm_shift is set to "<shift>"
    When the longest stopped interval between consecutive shift runs is computed
    Then that stopped gap is strictly less than 24 hours

    Examples:
      | shift   |
      | day     |
      | evening |
      | night   |

  # BL-660 applier-idempotent-no-clobber-07
  Scenario: the shift applier is idempotent and never clobbers a line it did not render
    Given swarm_shift is set to "night"
    And the shift schedule applier has already rendered the crontab
    When the shift schedule applier runs again with unchanged conf
    Then the crontab is unchanged
    And a human-edited crontab line the applier did not render is surfaced not overwritten

  # BL-660 shift-change-while-running-08
  Scenario: a shift change while the swarm is running takes effect at the next boundary
    Given swarm_shift is "day" and the swarm is running inside the day shift
    When swarm_shift is changed to "evening" before the day shift ends
    Then the current day shift continues until its scheduled stop
    And the evening shift schedule applies only from the next boundary onward

  # BL-660 outage-credit-extends-close-capped-09
  Scenario: a signature-backed provider outage extends close time within the cap
    Given swarm_shift is set to "night" with scheduled stop "09:00" local
    And a signature-backed provider outage of 90 minutes occurred during the shift
    When the effective close time is computed with a 2-hour credit cap
    Then the credited close time is "10:30" local
    And an extended-close announcement naming the credited interval is posted to the Operator topic

  # BL-660 swarm-downtime-never-credits-10
  Scenario: swarm-caused downtime never extends the shift close
    Given swarm_shift is set to "night" with scheduled stop "09:00" local
    And the swarm crashed and restarted on its own during the shift
    When the effective close time is computed
    Then the credited close time remains "09:00" local
    And no outage credit is applied for the crash interval
