# BL-635 architect SEND BACK #2 — invariant 3 still violated on `roundsPerClose`, and now on the legacy corpus

- **Ticket**: BL-635 (`rework-metric-in-briefing-flow-balance`)
- **Reviewed commit**: `3543b2b019` (cleaner) — merged for review, reverted out of
  `swarmforge-architect` with this bounce per BL-490.
- **Bounced by**: architect · **Blamed**: coder · **Class**: behavior
- **Date**: 2026-07-26 · **Prior**: SEND BACK #1 (`73419cd0e1`)

## What SEND BACK #1 asked for, and what came back

Four of the five sites are genuinely fixed, and well:

| # | Site | Status |
|---|------|--------|
| 2 | zero-closes window returns `null` | **fixed** (`windowPoint`, `closed === 0`) |
| 3 | `roundsPerClose` carrier can express unavailable | **fixed** (`Record<string, TrendedNumber \| null>`) |
| 4 | `renderReworkSuffix` renders the word `unavailable` | **fixed**, no `0.0`, no bare arrow |
| 5 | ship-day UTC boundary swallowed a real record | **fixed** (epoch pinned back to `2026-07-25`) |
| 1 | pre-epoch window on `roundsPerClose` | **PARTIAL — this bounce** |

`trendedRoundsPerClose` is a careful piece of work: it refuses a figure when the
current point is unavailable and drops to `direction: 'unknown'` rather than
computing a trend off a missing baseline. That is exactly right.

## Architecture verdict: CLEAN

- **Dependency-rule gate: PASSED** (exit 0, "no forbidden edges") across all 17
  parcel source/test files.
- Co-change: nothing at or above threshold (max 2 co-changes, threshold 3).
- Two-layer boundary, extension-host-owns-I/O, no-webview-storage,
  integrate-not-fork, secrets: all respected. The pure/adapter split
  (`quality/qaBounce.ts` policy ← `metrics/*Store.ts` adapters) is correct, and
  `attachFlowBalanceRework` splitting out of `buildCostHealthSidecar` is a good
  CRAP-budget call.
- Unit suite green (355 files, 6036 tests). Property suite green (14 files, 49
  tests).

**The parcel is sent back on the declared invariant, not on architecture.**

## Violated invariant (same one as SEND BACK #1)

> `invariants[2]`: "Absence of recorded data (a pre-epoch period) renders as
> unavailable on every surface — never as zero"

`windowPoint` guards only the case where the window lies **entirely** before the
epoch:

```ts
if (windowEndMs <= epochStartMs || closed === 0) { return { periodStart, value: null }; }
```

SEND BACK #1's remediation item 1 asked for a window that **starts** before the
epoch to be unavailable. A window that *straddles* the epoch still computes a
figure, blending measured days with unmeasured ones.

## Complete site list — one bounce, one property, every site

### Site 1 — a straddling window deflates the headline AND manufactures a trend arrow

Pre-epoch days contribute closed tickets to the denominator while being
structurally incapable of contributing bounces to the numerator: absence rendered
as a zero contribution.

Reproduced (`tmp/probe-warmup2.mjs`) in a world where the true architect rework
rate is a **flat 1.00 rounds/close throughout** and only the *recording* starts at
the epoch:

```
days after epoch | reported figure | trend arrow shown to the human
  + 3d           |        0.43     | (none)   (prior unavailable)
  + 5d           |        0.71     | (none)   (prior unavailable)
  + 7d           |        1.00     | (none)   (prior unavailable)
  + 9d           |        1.00     | UP ^     (prior 0.29)
  +11d           |        1.00     | UP ^     (prior 0.57)
  +14d           |        1.00     | flat     (prior 1.00)
```

Nothing changed in that world. The metric reports rework **understated by up to
57%** for a week, then paints a **rising ↑ arrow** on days ~8–13.

This lands precisely where it does the most damage. BL-633 and BL-634 ship
alongside this ticket, and BL-635 exists to say whether they helped — its own
`notes` say the metric becomes useful "once ~2 weeks of series exist". The entire
warm-up window renders a fabricated improvement-then-regression that is a pure
artifact of the epoch boundary. The ticket's data-honesty section forbids exactly
this: "It must not be renderable as a flat healthy line."

### Site 2 — the epoch is applied to roles that have real pre-epoch history, hiding the whole legacy corpus

The epoch is specced for the **by-attributed** series ("Recording epoch for the
by-attributed series"). It is applied globally, to every role in `rolesPresent` —
including `unattributed`, which is the entire 53-record legacy QA corpus that this
ticket's `source` section orders preserved:

> "**Preserve it** — a rename that orphans the old log path throws away the only
> history there is."

Reproduced against the **real** `.swarmforge/qa_bounces/2026-07.jsonl`
(`tmp/probe-legacy.mjs`), 53 genuine records spanning `2026-07-10` → `2026-07-25`:

```
REAL measured bounce records inside the 07-17..07-24 window: 23
  roundsPerClose[unattributed] = [ {2026-07-10: UNAVAILABLE}, {2026-07-17: UNAVAILABLE} ]

daily series over days that DO hold measured data:
  [ {2026-07-20: UNAVAILABLE}, {2026-07-21: UNAVAILABLE},
    {2026-07-22: UNAVAILABLE}, {2026-07-23: UNAVAILABLE} ]
```

52 of the 53 records are pre-epoch. The read path preserves them; the epoch guard
then renders every one unavailable. The corpus is **functionally orphaned** — the
exact outcome the ticket forbids, reached by a different route than the rename it
warned about.

This is the same invariant failing in the direction SEND BACK #1 site 5 named:
**recorded data rendered as absent.**

### Site 3 — the invariant-3 property test pins the defect as correct

`extension/test/reworkRounds.property.test.js` has a `straddling-epoch` category,
so the case was consciously reached — but the assertion enshrines the blend:

```js
assert.equal(currentPoint.value, records.length / closedDateIsos.length);
```

and the generator places bounce records anywhere in the window, including
**before the epoch** — records that cannot physically exist, since nothing
recorded a bounce until the recorder shipped. For that category the window is
`[2026-07-20 .. 2026-07-27)`: **5 of its 7 days are pre-epoch.**

The property is not vacuous, but it asserts the wrong property. It will stay green
against site 1 forever *and* will fail the corrected behaviour, so it actively
blocks the fix.

Stating invariant 3 correctly — bounces only post-epoch; any pre-epoch span in the
denominator means no honest figure — fails immediately against the shipped code
(`tmp/probe-property.mjs`, 300 runs):

```
CORRECTED invariant-3 property: *** FAILED *** against the shipped code
Counterexample: [[432000000],[0]]   (shrunk 21 times)
```

### Site 4 — the parcel would strip BL-654's shipped `architect.prompt` content

Not the invariant; a merge regression, and it must be fixed in the same rework.

BL-635 was parked to `hold` while **BL-654 was expedited through the stopped stack
and landed on `main`** (`9cdc0875a`, merged `8e8831a38`). The parcel branched
before that and has not merged `main` since, so its `architect.prompt` diff
**deletes** BL-654's Invariants Review section — the property-test existence and
non-vacuity check, the coder-owns-first-authorship rule, and the
`invariant-unencoded` failure class.

Two files changed on both sides of the merge-base (`8daa18e39`):

```
specs/pipeline/steps/index.js
swarmforge/roles/architect.prompt
```

Landing as-is silently reverts a shipped ticket.

## Remediation

1. **Site 1** — make a window whose span includes pre-epoch time honest. Either
   return unavailable when the window *starts* before the epoch, or clamp the
   window to the epoch and compute the ratio over the measured sub-period only
   (clamping is the better metric — it yields a real figure sooner). Whichever is
   chosen, no fabricated denominator and no trend arrow derived from one.
2. **Site 2** — stop applying the by-attribution epoch to roles that have genuine
   pre-epoch history. The epoch is a property of *when a role's attribution began
   being recorded*, not a global wall. `unattributed` has data from `2026-07-10`;
   gate per-role (e.g. first-record date per role, or exempt `unattributed`),
   never one global date for all.
3. **Site 3** — correct the invariant-3 property: generate bounce records only at
   or after the epoch, and assert unavailable whenever the denominator draws on
   unmeasured time. It must fail against today's implementation before the fix and
   pass after.
4. **Site 4** — merge `main` into the branch and re-resolve `architect.prompt`
   keeping BL-654's Invariants Review section, plus `specs/pipeline/steps/index.js`.
   Re-run both suites after the merge (a merge that touches only one side of a hunk
   can silently drop the other).
5. Cover sites 1 and 2 with unit tests too, not only properties — both suites are
   green **with** the defect present today.

## Note for the specifier (no action needed from the coder)

Acceptance scenario 12 pins the epoch rule to the daily series only. Neither the
straddling-window case nor the legacy-corpus case has a scenario, which is why two
green suites and a green property run all missed this twice. A scenario pinning
"a window overlapping the epoch" and one pinning "the legacy corpus stays
readable" would close it at the acceptance gate.

## Not blocking, surfaced only

Untracked in the architect worktree and not created by this review, left unstaged
per BL-506: `swarmforge/scripts/test/test_swarm_handoff_mono_router_auto_rotate.sh`,
`node_modules/`.

By architect.
