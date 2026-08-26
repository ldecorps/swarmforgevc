## BL-551 QA bounce — 2026-07-22

**Failing command:**
```
bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-551-llm-invocation-cost-ledger.feature
```

**Commit hash tested:** `d62b49c55d51baa61da8f7acc2763afc844e8180` (documenter handoff tip,
fast-forwarded into QA; `4cb5cf901` hardener merge and `8a1e36c1f` architect→hardener
merge confirmed ancestors)

**First error excerpt (first of 16 identical failures — every scenario fails, including
Background-only scenarios):**
```
TAP version 13
# Subtest: every llm_invocation record carries origin attribution for where the spend came from
not ok 1 - every llm_invocation record carries origin attribution for where the spend came from
  ---
  duration_ms: 33.574851
  type: 'test'
  error: 'Scenario "every llm_invocation record carries origin attribution for where the spend came from": no step handler matched "And origin trend series use three time bands with finer buckets toward the latest measurement"'
  code: 'ERR_TEST_FAILURE'
  ...
1..16
# tests 16
# suites 0
# pass 0
# fail 16
```

**Failure class:** acceptance

**Expected vs observed:** Expected all 16 scenarios in
`specs/features/BL-551-llm-invocation-cost-ledger.feature` to pass (background line
"origin trend series use three time bands with finer buckets toward the latest
measurement" resolved by a step handler); observed 16/16 fail because that Background
step has **no matching step handler** — `specs/pipeline/steps/bl551LlmCostLedgerSteps.js`
only registers handlers for the original scenarios (schema-01 through sidecar-09) and
was never extended for the trend-chart scenarios (trend-series-11 through trend-surface-15)
that the specifier added to the Background and scenario list. Since the missing step is
in the shared Background, it fails *every* scenario in the file, not only the six
trend-specific ones.

Root cause, confirmed by source inspection: none of `buildOriginCostTrendSeries`,
`originCostTrendSeries`, or a `/cost-trend` endpoint exist anywhere under
`extension/src/` — the ticket's own notes (`backlog/done/M8/BL-551-llm-invocation-cost-ledger.yaml`)
call for a pure `buildOriginCostTrendSeries` reader, a `GET /cost-trend` bridge route,
and a sidecar/PWA trend surface, none of which were implemented. Per
`workflow.prompt` ("Amending An In-Flight Ticket's Spec" — a spec amendment that adds
scenarios also adds work: wire step handlers in the same parcel or the acceptance
runner hard-fails on unhandled scenarios), the trend-chart amendment (scenarios 10-15)
was never implemented or wired.
