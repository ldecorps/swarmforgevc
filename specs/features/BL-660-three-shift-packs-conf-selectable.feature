Feature: three named shift packs selectable in conf

  # BL-660: exactly one of day (09:00-17:00), evening (17:00-01:00), or night
  # (01:00-09:00) local may be active via `config swarm_shift <name>`. When
  # active, the shift is the sole schedule source for cron start/stop, BL-617
  # cooldown inverse, BL-658 closure_stop_local, and briefing timing. Absent
  # or blank → 24/7 semantics identical to disabled cooldown window today.
  # Operator 2026-07-26: "ce serait bien d'avoir une swarm basée sur les 3
  # huits: 9am-5pm day, 5pm-1am evening, 1am-9am night. et comme ça dans la
  # conf on peut activer l'un des 3."

  Background:
    Given a fixture swarm root with shift schedule seams and controllable clocks

  # BL-660 night-shift-single-source-01
  Scenario: night shift drives start stop and cooldown inverse from one conf line
    Given swarmforge conf has config swarm_shift night for fixture root R
    When the shift schedule is resolved for root R
    Then scheduled start is at 01:00 local and scheduled stop at 09:00 local
    And BL-617 cooldown pause covers 09:00 through 01:00 local
    And closure_stop_local equals the shift end

  # BL-660 day-to-evening-switch-02
  Scenario: switching active shift in conf uses the new boundaries on the next cycle
    Given swarmforge conf had config swarm_shift day for fixture root R
    And the schedule crontab was applied for root R
    When conf is changed to config swarm_shift evening and the applier reconciles
    Then the rendered crontab start line fires at 17:00 local and stop at 01:00 local
    And no stale day-shift start or stop line remains for root R

  # BL-660 absent-shift-24-7-03
  Scenario: absent swarm_shift preserves disabled-window 24/7 semantics
    Given swarmforge conf has no config swarm_shift line
    And cooldown_window_enabled is false or absent
    When shift resolution runs for fixture root R
    Then scheduling behaves byte-identically to today's disabled cooldown window

  # BL-660 evening-midnight-span-04
  Scenario: the evening shift that spans midnight starts and stops on the correct calendar days
    Given swarmforge conf has config swarm_shift evening for fixture root R
    When the schedule crontab is rendered for root R
    Then the start cron fields target 17:00 on the local calendar day
    And the stop cron fields target 01:00 on the following local calendar day

  # BL-660 manual-start-outside-shift-05
  Scenario: a manual start outside the active shift is not paused killed or re-scheduled
    Given swarmforge conf has config swarm_shift day for fixture root R
    And the swarm is stopped outside the day shift window
    When the operator runs a manual start for root R
    Then the swarm stays up without cooldown pause
    And scheduled boundaries apply normally on the next cycle

  # BL-660 offline-approvals-gap-06
  Scenario Outline: any single active shift leaves the Telegram offline gap under twenty-four hours
    Given swarmforge conf has config swarm_shift <shift> for fixture root R
    When the stopped gap between shift end and next shift start is computed
    Then the gap duration is strictly less than twenty-four hours

    Examples:
      | shift   |
      | day     |
      | evening |
      | night   |

  # BL-660 applier-idempotent-no-clobber-07
  Scenario: the schedule applier is idempotent and surfaces hand-edited crontab lines
    Given root R schedule lines are already current in the user crontab
    And a human-added crontab line exists that the applier did not render for root R
    When the schedule applier reconciles root R
    Then crontab -l for root R is unchanged except surfaced warnings
    And the human-added line remains present
