Feature: Context Budget dashboard on the SwarmForge Telegram Mini App console

  # Human-requested 2026-07-22 (GH-23), depends on GH-22 (telemetry recorder
  # + query CLI). Slice 4b of epic swarmforge-console / BL-517. Rides the
  # same Mini App bridge host as BL-526 (console menu) and BL-538 (paused
  # pager).
  #
  # HOST: Telegram Mini App HTML served by extension/src/bridge/bridgeServer.ts
  # (pre-auth shells like /console, /pipeline-grid, /resident-spy,
  # /paused-pager; JSON/data routes stay token-gated). Add a dedicated
  # /context-budget shell + a fourth button on the /console menu. Do NOT
  # invent a second unauthenticated public page or duplicate GH-22's
  # aggregation logic in TypeScript — the host shells out to
  # context_telemetry_cli.bb summary --json.
  #
  # SCOPE: numeric/text display only (no charts/timelines/stacked bars —
  # those are Slice 2, parked in
  # specs/features/GH-23-context-budget-slice-2-visualisation.feature.draft).
  # Because GH-22's live capture wiring (its own Slice 2) has not landed,
  # data only exists where fixtures or the CLI's `record` command put it —
  # the empty state below is a REQUIRED scenario, not an edge case.

  Background:
    Given the SwarmForge bridge Mini App is reachable with my allowlisted console token
    And the console menu at /console is available

  # GH-23 dashboard-open-with-data-01
  Scenario: opening the dashboard for an agent with recorded telemetry shows its summary
    Given agent "coder" has 2 recorded telemetry events including 1 compaction
    When I open the Context Budget dashboard from the console menu for "coder"
    Then the page shows "coder"'s provider and model
    And shows the number of compactions
    And shows the context utilisation percentage
    And shows the token counts recorded for "coder"

  # GH-23 dashboard-empty-state-02
  Scenario: opening the dashboard for an agent with no recorded telemetry shows an empty state
    Given agent "documenter" has zero recorded telemetry events
    When I open the Context Budget dashboard from the console menu for "documenter"
    Then the page shows a message that no telemetry has been recorded yet for "documenter"
    And does not show a data table or an error

  # GH-23 dashboard-agent-picker-03
  Scenario: the dashboard lets me switch between agents that have recorded telemetry
    Given agents "coder" and "hardener" each have at least one recorded telemetry event
    When I open the Context Budget dashboard for "coder"
    And I switch the agent picker to "hardener"
    Then the page now shows "hardener"'s summary instead of "coder"'s

  # GH-23 dashboard-requires-console-token-04
  Scenario: the dashboard is not reachable without an allowlisted console token
    Given I do not have an allowlisted console token
    When I request the /context-budget page
    Then access is denied
