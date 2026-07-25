# BL-635 architect SEND BACK #1 — invariant 3 violated on the roundsPerClose surface

- **Ticket**: BL-635 (`rework-metric-in-briefing-flow-balance`)
- **Reviewed commit**: `73419cd0e1` (cleaner) — merged for review, reverted out of
  `swarmforge-architect` with this bounce per BL-490.
- **Bounced by**: architect · **Blamed**: coder · **Class**: behavior
- **Date**: 2026-07-26

## Verdict

Architecture is **clean**. The dependency-rule gate passes on every changed file
(exit 0, no forbidden edges); the two-layer boundary, extension-host-owns-I/O,
no-webview-storage and integrate-not-fork rules are all respected; the
pure/impure split (`quality/qaBounce.ts` policy ← `metrics/*Store.ts` adapters)
is correct and the legacy-store DRY extraction is well judged. Co-change
reported nothing above threshold. Unit suites are green (137 tests).

The parcel is sent back on a **declared invariant**, not on architecture.

## Violated invariant

> `invariants[2]`: "Absence of recorded data (a pre-epoch period) renders as
> unavailable on every surface — never as zero"

The parcel honours this on **one** of the two rework surfaces and not the other.
`computeDailyReworkSeries` takes an `epochIso`, returns `null` for a pre-epoch
day and renders the literal word `unavailable`. Its sibling
`computeRoundsPerCloseSeriesByRole` — the **headline** metric, and the one
`required_wiring` pins as load-bearing (`flowBalance.rework.roundsPerClose`) —
has no epoch concept at all and reports a fabricated `0`.

This is the invariant-sweep case BL-633 exists for: the property is quantified
over the whole slice, and acceptance scenario 12 only points at the daily
series, so a green suite proves nothing about the other surface.

## Complete site list (fix the class, not the instance)

**Site 1 — `extension/src/metrics/reworkRounds.ts::computeRoundsPerCloseSeriesByRole`
(no `epochIso` parameter).** A window lying entirely before
`REWORK_ATTRIBUTION_EPOCH_ISO` (`2026-07-26`) computes `0 bounces / N closed = 0`
instead of unavailable. Reproduced with three `by: architect` records dated
2026-07-27, `nowMs` = 2026-07-28:

```
roundsPerClose  architect: [ {2026-07-14, value: 0}, {2026-07-21, value: 1} ]
                             ^^^^^^^^^^^^^^^^^^^^^ entirely pre-epoch: nothing
                             was ever recorded for by:architect before the epoch
daily series for the same pre-epoch days: [ {2026-07-19, null}, {2026-07-20, null} ]
                                            ^^^^ correct, and directly contradicts the above
```

Because the epoch is *today*, the prior window is wholly or partly pre-epoch for
the **first fourteen days** after this ships — exactly the warm-up the ticket's
own `notes` say the metric becomes useful across ("once ~2 weeks of series
exist"). Every by-attributed role reports a manufactured baseline through it.

**Site 2 — same function, the zero-closes branch**
(`closedPrior > 0 ? priorBounces / closedPrior : 0`, both windows). A window with
no closed tickets has no measurable rounds-per-close; reporting `0` renders
absence as data *and inverts the signal*. Reproduced — five recorded architect
bounces with nothing closed:

```
no tickets closed at all -> architect: [ {value: 0}, {value: 0} ]
```

Maximum rework with zero throughput renders as a perfectly healthy `0.0`. This
is the precise failure mode the ticket's data-honesty section forbids: "It must
not be renderable as a flat healthy line."

**Site 3 — `extension/src/notify/costHealthSidecar.ts::attachFlowBalanceRework`
→ `flowBalance.rework.roundsPerClose`.** `trendedFromSeries` converts the
fabricated pre-epoch `0` into a **trend arrow**. `TrendedNumber` has no
representation for "unavailable", so as the contract stands the sidecar JSON
cannot express the honest answer even if the computation were fixed.

**Site 4 — `extension/src/notify/costHealthSidecar.ts::renderReworkSuffix`.**
Renders `, rework architect 1.0 ↑ rounds/close` — where the `↑` is derived
entirely from the pre-epoch zero at site 1. `.toFixed(1)` has no unavailable
path, so the markdown briefing (the surface a human actually reads) states a
trend the data cannot support.

## Remediation

1. Give `computeRoundsPerCloseSeriesByRole` the same `epochIso` treatment its
   sibling already has: a window that starts before the epoch yields
   *unavailable*, not `0`. Treat a zero-closes window the same way.
2. Widen the carrier so unavailable is expressible end to end — `roundsPerClose`
   needs a nullable value (or an explicit `unavailable` discriminator) rather
   than a bare `TrendedNumber`, and no trend arrow may be computed against an
   unavailable baseline.
3. `renderReworkSuffix` must render the word `unavailable` (never `0.0`, never a
   bare arrow) for a role whose window is unavailable — matching
   `renderDailyReworkMarkdownLine`, which already gets this right.
4. Cover it: the existing suite is green *with* the defect present, so the fix
   needs a test that fails without it — pre-epoch window on `roundsPerClose`, and
   the zero-closes window, on both the sidecar field and the rendered line.

Note for the specifier (no action needed from the coder): acceptance scenario 12
covers the epoch rule for the daily series only. A scenario pinning the same rule
to `roundsPerClose` would have caught this at the acceptance gate.

## Not blocking, surfaced only

Untracked in the architect worktree and not created by this review:
`swarmforge/scripts/test/test_swarm_handoff_mono_router_auto_rotate.sh`. Left
unstaged per BL-506 — not swept, not committed.

By architect.
