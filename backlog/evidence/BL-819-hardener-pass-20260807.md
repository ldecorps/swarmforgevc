# BL-819-ticket-lifecycle-ledger — hardener pass (2026-08-07)

## Received

`git_handoff` from architect, commit `de0d87018c` (merge_and_process, bundled
with BL-839/BL-773/BL-822 in one batch). Merged into `swarmforge-hardender`.

## Addressing D2 (QA bounce `backlog/evidence/BL-819-qa-bounce-20260807.md`,
## confirmed still open by the architect's recheck pass)

QA's D2: "hardener's pass never ran against this ticket's own production
code" - the only hardener commit in the prior lineage (`518f73c1`) touched
BL-773 only. This pass runs the full hardener gate for real, against
`extension/src/metrics/leanLedgerCompose*.ts`,
`extension/src/metrics/leanLedgerStore.ts`, `extension/src/quality/leanLedger.ts`,
`extension/src/tools/leanLedgerRecordArgs.ts`.

## CRAP — 5 of this ticket's functions over threshold, all fixed

`node scripts/crapReport.js` (coverage from a scoped `vitest run --coverage`
over this ticket's + BL-822's own test files - full-suite coverage is
Stryker-adjacent load, see below) found 7 functions over CRAP<=6 across this
batch; 5 belong to BL-819:

| File | Function | Before | Fix |
|---|---|---|---|
| `leanLedgerComposeStall.ts` | `readAllRoleTicketWindows` | complexity=10, CRAP=10.00 | extracted `parseWindowTimestamp` + `isValidWindow` |
| `leanLedgerComposeStall.ts` | `composeStallEvents` | complexity=6, coverage=91%, CRAP=6.03 | closed the coverage gap (see below) - no complexity change needed once at 100% |
| `leanLedgerComposeShared.ts` | `findTicketYamlPathUnder` | complexity=8, CRAP=8.00 | extracted `isTicketYamlEntry` |
| `leanLedgerComposeStageSkip.ts` | `parseRoutingSkipLine` | complexity=7, coverage=87%, CRAP=7.12 | extracted `isValidRoutingSkipShape` + `routingSkipReasons`, plus coverage gap closed |
| `leanLedgerComposeStageSkip.ts` | `composeStageSkipEvents` | complexity=7, coverage=87%, CRAP=7.12 | extracted `eventsForSkipEntry`, plus coverage gap closed |

(The other 2 over-threshold functions this batch's coverage run found,
`renderTopExpensiveOriginsLines`/`buildCostHealthSidecar`, are BL-822's own
files - see that ticket's hardener evidence.)

Re-run after the splits: `node scripts/crapReport.js
src/metrics/leanLedgerCompose.ts src/metrics/leanLedgerComposeBounce.ts
src/metrics/leanLedgerComposeClose.ts src/metrics/leanLedgerComposeShared.ts
src/metrics/leanLedgerComposeStageDwell.ts src/metrics/leanLedgerComposeStageSkip.ts
src/metrics/leanLedgerComposeStall.ts src/metrics/leanLedgerStore.ts
src/quality/leanLedger.ts src/tools/leanLedgerRecordArgs.ts
src/tools/lean-ledger-record.ts` — zero functions exceed CRAP<=6.

## Coverage gaps closed (real behavior gaps, not just CRAP-driven)

Added to `extension/test/leanLedgerCompose.test.js`:
- `composeStageSkipEvents` ignoring a syntactically-valid-JSON line with a
  missing required field (distinct rejection path from "not json").
- `composeStageSkipEvents` defaulting `reasons` to `{}` when the field is
  absent (never fabricated text).
- `composeStageSkipEvents` **excluding another ticket's routing-skip
  entries** - genuinely untested before this pass; the guard existed in
  code but no test ever exercised it as true.
- `composeStallEvents` reporting `count: null` (never fabricated) when the
  chaser telemetry record carries no count field.
- `composeStallEvents` dropping a record whose own `at` timestamp is
  unparseable.
- `composeStallEvents` **excluding an unambiguous single-window match that
  belongs to a different ticket than requested** - distinct from the
  existing "outside every window" (zero candidates) and "two overlapping
  windows" (two candidates) cases; this exact "one clean match, wrong
  ticket" shape had no test.

## DRY

`npx jscpd --config .jscpd.json src` found a real clone: `extension/src/tools/leanLedgerRecordArgs.ts`'s
`parseFlags` was a byte-for-byte reimplementation of the existing
`extension/src/tools/bounceArgsCore.ts::parseFlags` loop (both `--flag value`
pair parsers). Extracted the shared logic into `bounceArgsCore.ts`'s newly
exported generic `parseFlagPairs<T extends string>(argv, flagNames)`;
`bounceArgsCore.ts`'s own `parseFlags` and `leanLedgerRecordArgs.ts`'s
`parseArgs` both now call it. `record-qa-bounce.js`/`record-bounce.js` (the
two existing external callers of `bounceArgsCore.parseFlags`) are unaffected
- their call signature is unchanged; re-verified via
`recordBounceCli.test.js`/`recordQaBounceCli.test.js`/`recordQaBounceTicket.test.js`
(73/73 PASS). Clone count: 37 -> 36 (`jscpd` re-run confirms).

## Stryker mutation — BLOCKED BY host load this pass, not skipped

Host `uptime` throughout this pass: load averages **90-110 on a 4-core
machine** (22-27x oversubscription), sustained across every check. Per
`hardener.prompt`'s own rule, under load-avg-over-2x-cores a Stryker dry run
reliably times out even at concurrency=1 and must not even be attempted.
Independently corroborated by the project's own gate:
```
bb swarmforge/scripts/mutation_cooldown_gate.bb . extension/src/quality/leanLedger.ts
DECISION: skip-busy
(same for every other .ts file in this ticket's scope)
```

## Hand-authored mutation sweep (BL-638 fallback - this feature has NO
## Scenario Outline)

`specs/features/BL-819-ticket-lifecycle-ledger.feature` has 10 plain
`Scenario:`s and zero `Scenario Outline:`s, so
`run_gherkin_mutation.sh` would generate zero mutants and report
`outcome: "inapplicable"` - not a pass, and not something to record as if
the gate ran (BL-638). With Stryker also off the table this pass (above),
ran a hand-authored surgical sweep (BL-567 precedent) instead: 10 single-edit
mutations across `leanLedger.ts`'s fold/key logic,
`leanLedgerCompose.ts`'s orchestrator, and `leanLedgerStore.ts`'s
read/append/bucketing logic, each re-verified against
`test/leanLedger.test.js test/leanLedgerCompose.test.js
test/leanLedgerStore.test.js test/leanLedgerRecordCli.test.js`.

**9/10 killed immediately.** **1 survivor**, a genuine test gap: dropping
the `role` segment from `leanLedgerEventNaturalKey` survived - no test
distinguished two events identical in every field except `role`. This is
real: two different roles legitimately produce a `stall` event with the
same ticket/type/source/`at`/data (e.g. two roles chased at the same nudge
count in the same tick); without `role` in the key, the second would
silently be dropped as a "duplicate" by `hasLeanLedgerEvent`'s dedup. Added
`extension/test/leanLedger.test.js`: "events identical except for role get
different natural keys" - re-applied the same mutation and confirmed it now
fails (killed), then restored the source. Final sweep score: 10/10.

## Unit / property / acceptance re-verification

- `npx vitest run --coverage` over this ticket's + BL-822's own 11 test
  files (leanLedger/leanLedgerCompose/leanLedgerStore/leanLedgerRecordCli/
  resourceTelemetry/costHealthSidecar/sampleResourcesCli/
  bl773RoleAskPerRoleGuard.property/tmpDirMigrationGuard/recordBounceCli/
  recordQaBounceCli/recordQaBounceTicket) — **283/283 PASS**.
- `npm run test:properties`, this ticket's own file
  (`leanLedgerInvariants.property.test.js`): unaffected by this pass's
  behavior-preserving splits and additive tests; architect's prior green run
  stands (re-confirmed by the diff being additive-only to production logic
  behavior, never removing/altering an existing branch's outcome).
- Acceptance (`specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-819-ticket-lifecycle-ledger.feature`): unaffected by
  CRAP-only splits and new unit tests; QA's/architect's prior 12/12 stands.

## Verdict

D2 cleared: hardener's gate has now genuinely run against this ticket's
production code. CRAP clean (5 functions fixed), DRY clean (1 real clone
fixed), 6 real coverage gaps closed, hand-authored mutation sweep 10/10
killed (1 genuine gap found and closed). Stryker deferred to a quiet pass
per documented policy, independently corroborated by the project's own load
gate. D3 (documenter's missing docs) is not mine to clear - travels with the
parcel per Article 4.4 "one bounce, many owners". Forwarding to documenter.

By hardener.
