# BL-904 hardener pass — 2026-08-19

## Scope

Received from architect as `merge_and_process architect d868f4db9a` (clean
pass, no bounce). Certified: `extension/src/metrics/swarmMetrics.ts`'s
`readFreshnessIncidentEvents`/`parseFreshnessIncidentLine`/
`freshnessIncidentLogPath`, and `extension/src/notify/costHealthSidecar.ts`'s
`bucketDailyDaemonRestarts`/`trendedDaemonRestarts`.

## Live-verified (independent re-run, not just trusting prior evidence)

- `npx vitest run test/costHealthSidecar.test.js test/swarmMetrics.test.js`
  (after a fresh `npm run compile`): 137/137 PASS, matching the architect's
  own count.
- Property lane (`npm run test:properties -- costHealthSidecar`): 2/2 PASS.
- Acceptance (`BL-904-sidecar-daemon-restarts-hardcoded-zero.feature`): 7/7
  PASS, `sfvc-bl904-*` fixture dirs: 0 before, 0 after.

## Hand-authored mutation probe found a real coverage gap, closed

No mutation tool applies at full-suite scale right now (host load, see
below), so — per BL-567/BL-638's surgical-sweep pattern — hand-mutated the
compiled output directly and re-ran the targeted suite before touching any
source, to decide whether it was worth a source-level fix:

Mutated `parseFreshnessIncidentLine`'s validity guard
(`!Number.isFinite(epoch) || !fields.daemon || !fields.action` ->
`false || !fields.daemon || !fields.action`, i.e. drop the epoch check) in
`out/metrics/swarmMetrics.js`. **All 137 existing tests stayed green** — no
existing fixture exercises a well-formed-except-for-epoch line (the existing
"malformed/truncated" test's bad line is missing the `action` field
entirely, not a bad `epoch` value specifically).

Traced the consequence past the reader, since a passing mutant with no
visible effect wouldn't be worth a test on its own: a non-numeric-epoch
event that slipped through would carry `epoch: NaN`. Downstream,
`bucketDailyDaemonRestarts` buckets it under a `NaN` key via
`bucketStartMs(NaN, ...)`, and `fillDailyBuckets`'s
`Math.min(...counts.keys())` propagates that `NaN` into `earliestDay` — the
`for (day = earliestDay; day <= nowDay; ...)` loop's condition is `NaN <=
anything`, always false, so the loop body never runs and the **entire day's
series collapses to `[]`**. `[]` is not `null`, so `trendedDaemonRestarts`
renders it exactly like the ticket's own "no data" case (value 0, empty
trend, `direction: 'unknown'`) — silently reproducing the EXACT deception
(a confident-looking zero standing in for missing data) this ticket exists
to close, and doing so for the WHOLE day, not just the one bad line. This
does not happen with the guard as shipped — the guard already prevents it —
but nothing would have caught a future regression that weakened it, given
zero test coverage of that specific input shape.

Restored the mutant, reverted to the original compiled output (`diff`
confirmed byte-identical), then closed the gap at the correct layer — the
reader, which is this ticket's own stated scope ("the reader that feeds
it") — rather than touching the shared, pre-existing `fillDailyBuckets`
(used by all five reliability fields, out of scope here). Added
`extension/test/swarmMetrics.test.js`: "readFreshnessIncidentEvents rejects
a record whose epoch value is present but non-numeric" (an `epoch=not-a-number`
line alongside a well-formed one; asserts only the well-formed one survives).
Confirmed it passes against the real implementation (138/138), then
re-applied the exact same mutant and confirmed the NEW test fails while
nothing else does — the mutant is now killed. Restored again, recompiled
fresh from source (`npm run compile`), re-ran the full targeted suite:
138/138 green.

## CRAP

`node scripts/crapReport.js src/metrics/swarmMetrics.ts
src/notify/costHealthSidecar.ts` against coverage from a scoped
(`costHealthSidecar`/`swarmMetrics` pattern) vitest run, same
narrow-run-inflates-unrelated-functions caveat as BL-905's own pass this
session: the one CRAP>6 flag (`readHandoffHeaderRecordAt`, CRAP=19.93) is
an unrelated pre-existing function in the same file, untouched by this
ticket, low-covered only because its own dedicated tests weren't in this
narrow run. Every function this ticket actually adds/touches:
`parseFreshnessIncidentLine` CRAP=6.00 (100% cov, right at the gate, not
over it), `readFreshnessIncidentEvents` CRAP=5.00, `freshnessIncidentLogPath`
CRAP=1.00, `bucketDailyDaemonRestarts` CRAP=5.00, `trendedDaemonRestarts`
CRAP=2.00 — all clean, all 100% covered.

## DRY

`npm run dry` (jscpd over `src`): no clone involving `swarmMetrics.ts` or
`costHealthSidecar.ts`. No duplication introduced.

## Mutation (Stryker) — DEFERRED again, host load still elevated

```
06:09  load averages: 14.89 16.44 18.35   (3.7x cores, 1-min)
06:14  load averages:  8.77 12.80 16.14   (2.2x cores, 1-min; 5/15-min still 3.2x/4.0x)
```
4 cores. The 1-min average dropped between checks but the 5-min and 15-min
averages stayed high throughout this pass (12-18 on 4 cores) — sustained
contention, not a blip that's about to clear. Per the office-hours bypass
policy: not stalling this parcel for it. The hand-authored mutation probe
above, plus the architect's own two independently-verified non-vacuous
property-test breaks (bounce-evidence style, both invariants), give real
signal on this ticket's two new pure functions even without a full Stryker
pass. **Recorded as BLOCKED BY host load, not skipped or implied to have
run** — same as BL-905's own deferral this session, for the same reason
(pipeline has landed three parcels in a row into a host that has not gone
quiet since).

## Verdict

Real coverage gap found and closed (non-numeric-epoch guard, would have
silently reproduced this ticket's own defect class on regression).
Coverage/CRAP/DRY clean for every function this ticket adds. Stryker
deferred to the next quiet host, recorded not silently skipped. Forwarding
to documenter.

By hardener.
