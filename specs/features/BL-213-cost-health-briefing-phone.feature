Feature: cost & health telemetry reaches the briefing and the phone

# BL-213 cost-05
Scenario: briefing carries the cost & health paragraph
  When the coordinator composes a briefing with telemetry available
  Then it includes per-agent cost one-liners, top expensive tickets,
    flow balance, and reliability counts, each with trend direction

# BL-213 cost-06
Scenario: phone sees daily figures via the committed briefing
  Given a committed briefing (or its json sidecar) with metrics
  When the Action regenerates backlog.json
  Then the daily cost/health figures appear in backlog.json
  And no runtime telemetry file was committed to git

# Non-behavioral gates:
#  - Depends on BL-100 (telemetry) and BL-097 (Action/backlog.json) being on
#    main, plus a decided briefing content path (coordinator.prompt contract
#    or deterministic sidecar) — see the ticket description.
#  - backlog.json changes are additive (schema_version respected).
#  - No runtime telemetry file committed to git; the briefing/sidecar carries it.
