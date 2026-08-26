# mutation-stamp: sha256=510fe04865435c4c6565947b9b78ab86dd0ce0a7d31ebee72cecb684fdfd9a27
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-22T18:17:22.651559944Z","feature_name":"LLM invocation cost ledger ranks expensive calls by origin over 3h, 24h, and 7d","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-551-llm-invocation-cost-ledger.feature","background_hash":"3e1868f2641fc8433b3e4bd6b9b49e8908a57c22e97bba08f0466b127176e63a","implementation_hash":"unknown","scenarios":[{"index":4,"name":"each named horizon ranks independently","scenario_hash":"e59185bcea51a29b1ec3cae7b9ce775f582588fb771a188ff3011c3c060ae6f2","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-22T18:17:22.651559944Z"}]}
# acceptance-mutation-manifest-end

Feature: LLM invocation cost ledger ranks expensive calls by origin over 3h, 24h, and 7d

  # Operator INTAKE (2026-07-22): cost optimisation — which swarm areas burn the most
  # tokens? Instrument at LLM invocation boundaries (wake / reap), not internal method
  # calls. Rank the most expensive invocations and show where they originated from.
  #
  # Builds on BL-100 (transcript + per-role/ticket rollups) and BL-511 (exact $ capture
  # at front-desk reap). This ticket adds a unified append-only ledger, multi-horizon
  # ranking (3h, 24h, 7d), and a 7-day per-origin trend chart (log time bands, log $
  # axis when warranted).
  #
  # Durable store: `.swarmforge/telemetry/llm-cost-YYYY-MM.jsonl` — one JSON object per
  # line, `type: llm_invocation`. Machine-local; never committed to git.
  #
  # Honest-null discipline: unknown `cost_usd` is null — excluded from dollar totals and
  # ranked after priced rows, never counted as $0.

  Background:
    Given the LLM cost ledger stores llm_invocation records with timestamp, model, token counts, cost in dollars, and an origin block
    And ranking is evaluated at a fixed injected instant with named horizons of 3 hours, 24 hours, and 7 days
    And origin trend series use three time bands with finer buckets toward the latest measurement

  # BL-551 schema-01
  Scenario: every llm_invocation record carries origin attribution for where the spend came from
    Given an llm_invocation record is appended to the ledger
    Then it includes subsystem, role, stage, trigger, ticket id, handoff id, handoff type, script, pack, model, and provider in its origin block

  # BL-551 writer-handoff-02
  Scenario: a pipeline handoff delivery stamps origin before the role is woken
    Given a handoff is delivered to a role with a known ticket and handoff type
    When the delivery wake is injected
    Then an llm_invocation correlation is recorded with trigger handoff and the handoff id and ticket id

  # BL-551 writer-reap-03
  Scenario: a headless claude reap records exact cost before its result file is deleted
    Given a headless claude invocation reports an exact total cost in json output
    When the invocation is reaped
    Then an llm_invocation record with that exact cost is appended before the result file is deleted
    And the record origin includes the reaping script name

  # BL-551 rank-single-04
  Scenario: top expensive calls in the last 3 hours are ranked by cost descending
    Given llm_invocation records within and outside the last 3 hours
    When top expensive calls are ranked for the 3 hour horizon
    Then only records inside the window are included
    And they are ordered by cost in dollars descending with unknown costs after priced rows

  # BL-551 rank-horizons-05
  Scenario Outline: each named horizon ranks independently
    Given llm_invocation records spread across the last week
    When top expensive calls are ranked for the <horizon> horizon
    Then only records inside the <horizon> window are included

    Examples:
      | horizon |
      | 3h      |
      | 24h     |
      | 7d      |

  # BL-551 group-by-06
  Scenario: rollups can group spend by origin trigger and role
    Given multiple llm_invocation records sharing the same trigger and role
    When spend is rolled up grouped by trigger and role for the 24 hour horizon
    Then each group shows summed cost in dollars and invocation count
    And groups are ordered by summed cost descending

  # BL-551 unknown-cost-07
  Scenario: unknown cost invocations are excluded from dollar totals
    Given a priced invocation and an invocation with unknown cost in the same window
    When top expensive calls are ranked for the 24 hour horizon
    Then the dollar total includes only the priced invocation
    And the unknown-cost invocation is never counted as zero dollars

  # BL-551 bridge-08
  Scenario: the cost rank endpoint returns top expensive calls for a requested horizon
    Given llm_invocation records in the ledger
    When an authorized request is made to the cost rank endpoint for the 24 hour horizon
    Then the response lists top expensive calls with origin attribution for that horizon

  # BL-551 sidecar-09
  Scenario: the daily cost health sidecar includes top expensive origins per horizon
    Given llm_invocation records across the last week
    When the cost health sidecar is emitted for the day
    Then it includes top expensive origins for the 3 hour, 24 hour, and 7 day horizons

  # BL-551 trend-graph-10 — operator ruling 2026-07-22: the human asked for a TREND,
  # not three disconnected horizon totals. Each top expensive origin gets a rolling
  # 7-day spend line: time runs left (oldest) → right (latest measurement). Origins
  # are ORDERED by cost in the rightmost bucket (most expensive at the last period
  # appear highest / first). "Same method" = the same origin fingerprint the rollups
  # already use (default role + trigger + script; extend groupBy only when surfaced).
  #
  # TIME AXIS — three logarithmic bands (shorter sampling as you approach now):
  #   Band A  (now-3h,  now]     finest buckets
  #   Band B  (now-24h, now-3h]  medium buckets
  #   Band C  (now-7d,  now-24h] coarsest buckets
  # Bucket widths within each band are NOT pinned here — specifier/coder choose
  # them; the contract is only relative (A finest, B between, C coarsest) and
  # that bands share equal visual width (log-compressed calendar time).
  #
  # Y-AXIS — logarithmic when the priced range across the series spans at least one
  # order of magnitude; otherwise linear. Unknown-cost invocations stay out of $ sums.
  #
  # SURFACES: PWA cost card renders the multi-line chart; briefing/sidecar carry the
  # same series payload (or a compact sparkline) so the phone view matches the board.

  # BL-551 trend-series-11
  Scenario: each top expensive origin gets a rolling seven day cost series
    Given llm_invocation records for the same origin spread across the last seven days
    When origin cost trend series are built for the rolling seven day window
    Then each origin series sums only priced invocations inside its bucket
    And bucket timestamps run from oldest on the left to the latest measurement on the right

  # BL-551 trend-sampling-12
  Scenario: trend buckets use finer sampling in the three hour band than in the seven day band
    Given llm_invocation records in the last three hours and between twenty four hours and seven days ago
    When origin cost trend series are built for the rolling seven day window
    Then the three hour band uses shorter bucket widths than the twenty four hour to seven day band
    And the three hour to twenty four hour band uses medium bucket widths between those two

  # BL-551 trend-rank-latest-13
  Scenario: top origins for the chart are ordered by cost in the latest bucket
    Given two origins where the cheaper one spent more in an older bucket but the pricier one spent more in the latest bucket
    When the top expensive origins are selected for the trend chart
    Then the origin with higher cost in the latest bucket is ranked above the other

  # BL-551 trend-log-scale-14
  Scenario: the chart uses a logarithmic cost axis when spend spans orders of magnitude
    Given an origin whose rolling seven day series spans at least a tenfold cost range
    When the trend chart scales are chosen
    Then the cost axis is logarithmic

  # BL-551 trend-surface-15
  Scenario: the cost surface shows one line per top origin across the rolling seven day window
    Given ranked origin trend series for the rolling seven day window
    When the cost trend chart is rendered for the human
    Then each ranked origin is drawn as one line with time increasing toward the right
    And the rightmost point is the latest measurement period for that origin
