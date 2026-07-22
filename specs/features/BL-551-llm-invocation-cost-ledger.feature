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
  # at front-desk reap). This ticket adds a unified append-only ledger and multi-horizon
  # ranking (3h, 24h, 7d).
  #
  # Durable store: `.swarmforge/telemetry/llm-cost-YYYY-MM.jsonl` — one JSON object per
  # line, `type: llm_invocation`. Machine-local; never committed to git.
  #
  # Honest-null discipline: unknown `cost_usd` is null — excluded from dollar totals and
  # ranked after priced rows, never counted as $0.

  Background:
    Given the LLM cost ledger stores llm_invocation records with timestamp, model, token counts, cost in dollars, and an origin block
    And ranking is evaluated at a fixed injected instant with named horizons of 3 hours, 24 hours, and 7 days

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
