# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-25T14:02:15.055979398Z","feature_name":"BL-1128 residual — headroom raise telemetry path and coordinator duty","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1132-headroom-raise-telemetry-path-and-coordinator-duty.feature","background_hash":"4da76a43b07f62e9bfdfb083be0f545c1ed9e3a69cbf86b542a5470c65116192","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: BL-1128 residual — headroom raise telemetry path and coordinator duty

  # BL-1132 — draft acceptance (specifier may tighten). Raise must read
  # live host_load samples; coordinator must own the CLI at cap.

  Background:
    Given BL-1128's headroom_cap_raise_cli is the owner for raising configured depth

  Scenario: telemetry-path resolves chaser month file without throw
    When telemetry-path is evaluated for the project root
    Then it returns a path ending in chaser-YYYY-MM.jsonl under .swarmforge/telemetry
    And evaluation does not throw

  Scenario: sustained under-max samples are not false pressure
    Given host_load_sample ratios below cpu-ratio-max covering the sustained window
    And memory headroom is met
    And throttle is not degraded or severe
    And configured depth is below ceiling and cooldown is clear
    When raise runs
    Then the action is raise (not noop reason pressure from a broken path)

  Scenario: coordinator duty names the raise CLI at cap
    Given active backlog is at the configured max depth
    And host headroom would allow a raise
    Then the coordinator's designed path is to run headroom_cap_raise_cli raise
    And hand-editing active_backlog_max_depth is not the designed recovery
