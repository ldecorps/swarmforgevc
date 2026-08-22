# BL-822-resource-anomalies-miss-host-load-spikes — hardener pass (2026-08-07)

## Received

`git_handoff` from architect, commit `de0d87018c` (merge_and_process, bundled
with BL-839/BL-773/BL-819 in one batch). Merged into `swarmforge-hardender`.

## Scope

`extension/src/metrics/resourceTelemetry.ts`, `extension/src/notify/costHealthSidecar.ts`,
`extension/src/tools/sample-resources.ts`.

## Stryker mutation — BLOCKED BY host load this pass, not skipped

Host `uptime` throughout this pass: load averages **90-110 on a 4-core
machine** (22-27x oversubscription), sustained across every check from
17:31Z to 18:00Z+ — the same severe-load signature BL-773's own QA bounce
evidence and this same batch's architect pass independently recorded
today. Per `hardener.prompt`'s own rule, under load-avg-over-2x-cores a
Stryker dry run reliably times out even at concurrency=1 and must not even
be attempted. Independently corroborated by the project's own gate:

```
bb swarmforge/scripts/mutation_cooldown_gate.bb . extension/src/metrics/resourceTelemetry.ts
DECISION: skip-busy
(same for costHealthSidecar.ts, sample-resources.ts)
```

Per the office-hours mutation bypass (operator policy 2026-07-06): forwarding
now with targeted-test/CRAP/DRY hardening rather than stalling the pipeline;
Stryker mutation lands on the next quiet pass.

## CRAP — 3 functions over threshold, fixed via behavior-preserving splits

`node scripts/crapReport.js` (coverage from a scoped `vitest run --coverage`
over this ticket's + BL-819's own test files, since full-suite coverage is
also Stryker-adjacent load) found:

| Function | Before | Fix |
|---|---|---|
| `renderTopExpensiveOriginsLines` | complexity=8, CRAP=8.00 | extracted `renderHorizonOriginLines` + `renderOriginGroupLine` |
| `buildCostHealthSidecar` | complexity=7, CRAP=7.00 | extracted `attachCostPerTicket`, mirroring the existing `attachFlowBalanceRework` split pattern already in this file |

(The third over-threshold function in this batch's coverage run,
`readAllRoleTicketWindows`, is BL-819's own file — see that ticket's
hardener evidence.)

Re-run after the split: `node scripts/crapReport.js src/notify/costHealthSidecar.ts
src/metrics/resourceTelemetry.ts src/tools/sample-resources.ts` — zero
functions exceed CRAP<=6.

## DRY

`npx jscpd --config .jscpd.json src` — no clone touching any of this
ticket's three files (the one clone this batch fixed, `bounceArgsCore.ts` /
`leanLedgerRecordArgs.ts`, belongs to BL-819 - see that ticket's evidence).

## Gherkin acceptance mutation (BL-113, soft)

`specs/features/BL-822-resource-anomalies-miss-host-load-spikes.feature` has
one `Scenario Outline` (4 Examples rows). Ran
`run_gherkin_mutation.sh ... soft`: 6 mutants generated, 2 killed
(`m9`/`m12`: mutating a row's own `severe` column flips the assertion and
fails, as it must), 4 survived (`m7`/`m8`/`m10`/`m11`: mutating `minutes` or
`ratio` within rows 3/4).

The 4 survivors are **equivalent mutants** (BL-234), not test gaps: row 3
(`ratio=20, minutes=5, severe=false`) fails on duration alone
(`minutes < host_load_sustained_minutes=15`) regardless of ratio, and stays
`false` for any `minutes` value that remains under 15 - mutating `minutes:
5->9` or `ratio: 20->18` both stay inside that same "still not sustained /
still above ratio threshold, verdict unchanged" region. Row 4
(`ratio=3, minutes=240, severe=false`) fails on ratio alone
(`ratio < host_load_severe_ratio=4`) regardless of duration - mutating
`minutes: 240->248` or `ratio: 3->2` both stay inside "still below ratio
threshold" region. `computeHostLoadVerdict`'s AND-of-two-thresholds design
means every value in that region provably produces the identical verdict;
no assertion could distinguish the original from these mutants without
testing implementation trivia the code doesn't have. Not treated as a fix
target. The manifest records `scenarios: []` per BL-502 (the Outline had
survivors, however equivalent), stamped into the feature file with
`implementation_hash` and `tested_at` current.

Because the survivors are all in the one `Scenario Outline`, the manifest's
`scenarios` list is empty per BL-502's "only clean scenarios recorded"
behavior - expected, not a re-run failure signature (BL-460's `total=0`
trap is a different, unrelated symptom).

## Unit / property / acceptance re-verification

- `npx vitest run test/resourceTelemetry.test.js test/costHealthSidecar.test.js
  test/sampleResourcesCli.test.js` — 138/138 PASS (unchanged by the CRAP
  splits - behavior-preserving).
- `npm run test:properties` (this ticket's file only, already re-run by
  architect and unaffected by hardener's non-behavioral splits).
- Acceptance (`specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-822-resource-anomalies-miss-host-load-spikes.feature`)
  unaffected by CRAP-only splits; architect's 9/9 stands.

## Verdict

CRAP and DRY clean; Gherkin acceptance mutation run with all survivors
verified equivalent; Stryker deferred to a quiet pass per documented policy,
independently corroborated by the project's own load gate. Forwarding to
documenter.

By hardener.
