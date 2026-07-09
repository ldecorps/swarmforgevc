Feature: token, cost, and resource telemetry with trends

# BL-100 cost-01
Scenario: per-agent daily tokens match the transcripts
  Given role worktree transcript JSONLs with known usage records
  When per-agent token metrics are computed for a day
  Then each role's input/output/cache totals equal the sum of its
    transcript usage entries for that day

# BL-100 cost-02
Scenario: per-ticket attribution is windowed and honest
  Given a role held ticket A for a known window and ticket B after it
  When per-ticket tokens are computed
  Then usage timestamped inside each window is attributed to that ticket
  And usage outside any holding window lands in the role's
    "unattributed" bucket

# BL-100 cost-03
Scenario: cost derives from the committed pricing table
  Given a pricing table version and known token totals
  When estimated cost is computed
  Then the dollar figures follow the table's per-model rates
  And cache-read tokens are priced at their own rate

# BL-100 cost-04
Scenario: resource samples become trends
  Given resource_sample telemetry lines across several hours
  When CPU/RAM metrics are queried
  Then per-role current values and windowed trends are reported

# BL-100 cost-05
Scenario: briefing carries the cost & health paragraph
  When the coordinator composes a briefing with telemetry available
  Then it includes per-agent cost one-liners, top expensive tickets,
    flow balance, and reliability counts, each with trend direction

# BL-100 cost-06
Scenario: phone sees daily figures via the committed briefing
  Given a committed briefing (or its json sidecar) with metrics
  When the Action regenerates backlog.json
  Then the daily cost/health figures appear in backlog.json
  And no runtime telemetry file was committed to git

# BL-100 cost-07
Scenario: absent data degrades to zeros
  Given a role with no transcript directory or no telemetry
  When any surface is queried
  Then zeros / "no data" render without errors

# Non-behavioral gates:
#  - Transcript parser is a pure function over provided JSONL lines
#    (fake transcripts in tests); filesystem discovery is a thin tested
#    adapter. ~/.claude transcripts are read-only inputs.
#  - Pricing table is versioned data in-repo; no rates hardcoded.
#  - backlog.json changes are additive (schema_version respected).
#  - BL-096 trend function reused unmodified for every new series.
