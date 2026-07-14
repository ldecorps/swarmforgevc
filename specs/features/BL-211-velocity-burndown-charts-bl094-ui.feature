Feature: BL-096 delivery metrics are charted in the BL-094 web UI

# BL-211 charts-render-01
Scenario: burndown and velocity charts render from the endpoint
  Given the bridge is running with BL-096 metrics and the web UI is open
  When the metrics section loads
  Then a burndown chart per milestone and a velocity chart render from the
    endpoint's JSON

# BL-211 presentation-only-02
Scenario: the UI computes no metrics itself
  Given the metrics section is displayed
  When it renders a chart
  Then every value shown comes from the endpoint's JSON, with no computation
    in the UI

# BL-211 empty-state-03
Scenario: missing metric data renders an empty state, not an error
  Given the endpoint reports "no local data" for a metric
  When the metrics section renders that metric
  Then it shows an empty or "no data" state without error

# Non-behavioral gates:
#  - Presentation-only on top of the BL-096 endpoint; no metric computation
#    in the UI.
#  - Follows BL-094 guardrails (no browser storage, token-gated bridge,
#    extension-host owns I/O).
