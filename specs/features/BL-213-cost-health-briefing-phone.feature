Feature: daily cost & health reaches the briefing and the phone via a sidecar

# BL-213 cost-05a
Scenario: a deterministic sidecar is emitted from the telemetry producers
  Given a day's BL-100 cost/health telemetry
  When the daily briefing flow runs
  Then it emits a committed docs/briefings/<date>.json sidecar
  And the sidecar carries per-agent tokens and cost, top expensive tickets,
    flow balance, reliability counts, and CPU/RAM anomaly flags
  And each figure carries a trend direction
  And no raw runtime telemetry file is committed

# BL-213 cost-05b
Scenario: the briefing section is rendered from the sidecar
  Given a committed sidecar for the day
  When the briefing markdown is composed
  Then its "Cost & Health" section shows exactly the sidecar figures
  And no figure is invented outside the sidecar

# BL-213 cost-05c
Scenario: a day with no sidecar omits the section
  Given no sidecar exists for the day
  When the briefing markdown is composed
  Then the "Cost & Health" section is omitted without error

# BL-213 cost-06a
Scenario: the Action folds the latest sidecar into backlog.json
  Given a committed docs/briefings/<date>.json sidecar
  When the backlog dashboard Action generates backlog.json
  Then the daily cost/health figures appear under a new optional field
  And schemaVersion is unchanged because the field is additive

# BL-213 cost-06b
Scenario: the phone renders the figures, and hides them when absent
  Given backlog.json <cost_health_field>
  When the PWA renders
  Then the cost & health card <visibility>

  Examples:
    | cost_health_field | visibility |
    | is present        | is shown   |
    | is absent         | is hidden  |

# Non-behavioral gates:
#  - Sidecar emit and Action fold-in are pure over provided inputs (fixtures);
#    no network, no real timers. BL-096 trend function reused unmodified.
#  - Only the daily-aggregate sidecar is committed — it is the sole carrier;
#    raw transcript/resource telemetry stays local.
#  - backlog.json stays schemaVersion 1 (additive); the PWA keeps its single
#    backlog.json fetch — no second fetch path.
#  - The coordinator.prompt "use the emitted figures verbatim" instruction is a
#    specifier-owned prompt edit landing with integration, not coder work.
