# BL-910 — architect review pass 1: complete inventory

- **Ticket**: BL-910 projected ETA on the briefing burndown (`type: feature`, `severity: medium`)
- **Commits reviewed**: `7f167897c` (coder) + `91593b8da7` (cleaner) — merged as `8e9f42e44`
- **Reviewer**: architect, 2026-08-20
- **Prior bounces**: none — first architect pass
- **Verdict**: **PASS — defects found: NONE.**

## Invariant 1 is enforced by the type, not by a branch

The ticket's hard human condition ("never a date, never 'never', never a fabricated
infinity") is encoded as a discriminated union rather than a renderer branch:

```ts
export type NotDoneBurndownProjection =
  | { kind: 'eta';    netBurnPerDay: number; etaDays: number; etaDateLabel: string }
  | { kind: 'no-eta'; netBurnPerDay: number; reason: string }
```

The not-shrinking case has no field that could carry a date. That is the right shape
for an invariant the ticket explicitly says must not be "a branch in one renderer".

`required_wiring` is satisfied in substance, not just by the literal: `NOT_SHRINKING_REASON`
lives in `notDoneBurndown.ts:43` (the gate's file+pattern), and the reason is genuinely
DRAWN — `notDoneBurndownChart.ts:105` builds the line and `:112` emits it as a `<text>`
element. `buildNotDoneBurndownSvg` additionally throws when a series arrives without a
projection (`:35`), so "computed but not drawn" fails loud instead of rendering blank.

## The cleaner found a real invariant-2 defect, and I re-derived its fix independently

`projectNotDoneEta` rounded both rates to integer tenths and then divided by the
RECONSTRUCTED float, reintroducing the dust the rounding removed — `Math.ceil` turning
it into a whole extra day. The cleaner fixed it to `ceil(openN * 10 / netBurnTenths)`.

I did not take the 900k-case claim on trust. Re-running it myself against exact BigInt
rational arithmetic:

```
checked 900300 | integer-tenths mismatches vs exact: 0 | OLD float form disagreements: 735
```

Zero mismatches for the shipped form; the old form disagreed with a hand-dividing
reader in 735 of those cases. The defect was real and the fix is exactly right.

**Non-vacuity of the regression, verified by me** — I patched the compiled `out/` back
to the float form and re-ran the unit file:

```
× BL-910 invariant 2: an ETA that divides EXACTLY is not pushed a day out by float dust
✓ (all twelve other tests)
```

Exactly one test fails, and every pre-existing test passes on the broken form —
confirming the cleaner's claim that nothing in the suite covered this class before.
Build restored to the fixed form afterwards.

## The cleaner flagged touching a property test — I judge that correct

The cleaner explicitly surfaced (rather than doing quietly) that it modified
`notDoneBurndownEta.property.test.js`, normally outside its lane. **That was the right
call and the right change.** The old invariant-2 property recomputed the expected day
count with the SAME float expression as the implementation, so it agreed with the code
precisely where both disagreed with the reader — a tautological property guarding the
contract it was supposed to enforce. It now recomputes in exact BigInt arithmetic
"the way a READER does it". Leaving the mirrored version would have handed the hardener
a property that certifies the bug.

**Both properties are non-vacuous — I broke each one:**

| break applied to compiled `out/` | result |
|---|---|
| `netBurnTenths <= 0` → `< 0` (zero net burn falls through to a date) | invariant 1's property FAILS |
| division reverted to the float form | invariant 2's property fails — but only ~1 run in 3 |

That second row is the gap the cleaner honestly flagged for the hardener: the generator
reaches an exactly-dividing pair rarely, so the property is a weak detector for this
class. I measured it (1 of 3 trials caught it). **It is not a defect and not a
send-back**, because the class has DETERMINISTIC coverage via the new unit regression
proven above, and generator strengthening is property-test authoring the hardener owns.
Worth doing there.

## Checks run — full inventory

| # | Check | Result |
|---|---|---|
| 1 | Merge lineage (`91593b8da7` ancestor of HEAD) | PASS |
| 2 | Registry conflict resolved WITHOUT re-admitting bounced BL-959 | PASS — see below |
| 3 | BL-571 hot-sync strays not lost in the merge | PASS — arrived as the sender's own committed content, byte-identical; 12 occurrences present after merge |
| 4 | Prior bounce on this ticket | PASS — none |
| 5 | **Invariant 1 — a date only when net burn is strictly positive** | PASS — enforced by the union type; property + rendered-SVG assertions |
| 6 | **Invariant 2 — ETA recomputable from the printed counts** | PASS — integer-tenths derivation matches `toFixed(1)` display exactly; re-derived over 900,300 cases |
| 7 | **Property tests exist AND are non-vacuous** | PASS — I reproduced both breaks |
| 8 | `required_wiring` — `notDoneBurndown.ts::no ETA` | PASS — literal present; and the reason is genuinely rendered (`Chart.ts:105`/`:112`), with a loud throw on a missing projection |
| 9 | Unit suite `notDoneBurndown.test.js` | PASS — 13/13 (see build note) |
| 10 | Property lane `notDoneBurndownEta.property.test.js` | PASS — 2/2, no `Unhandled Error`/`Rejection` in output (BL-871) |
| 11 | Acceptance: BL-910 feature | PASS — 9/9 |
| 12 | Policy independent of IO/UI | PASS — and improved by BL-896's earlier split: `notDoneBurndown.ts` is pure computation, `notDoneBurndownChart.ts` is rendering; the projection is derived in the pure half |
| 13 | Projection names its scope, no second disagreeing ETA | PASS — both branches read "all open tickets"; no milestone p50/p85 anywhere on the chart; BL-228's `deliveryMetrics` untouched |
| 14 | Heading still says "burndown" (human decision 2) | PASS — asserted by unit test |
| 15 | **Dependency gate (hard gate)** | RED repo-wide, **not attributable** — BL-759's pre-existing telegram cycle; this parcel touches only `extension/src/metrics/` and adds no edge |
| 16 | Co-change coupling | Informational — the one unmoved partner is correct (see below) |
| 17 | `gitHistoryAdapter.test.js`, `renderBriefingBurndownCli.test.js` | **BLOCKED — not assumed clean** (see below) |
| 18 | Architect property-coverage pass (undeclared properties) | No new property required — both declared invariants are covered, and the one weak spot is a generator-strength item routed to the hardener rather than a missing property |

### Check 2 — the merge could have re-admitted content I bounced

The sender predates my BL-959 bounce revert (`7ab198b4b5`), so its registry still
required `bl959ApsEquivalenceSteps`. Git correctly kept my revert's deletions, so the
`aps_equivalence_*` files stayed absent — resolving the conflict "the sender's way"
would have pointed the registry at a file that no longer exists AND let bounced content
ride forward. Resolved to `bl571+bl958+bl960+bl957+bl910`; verified 0 `bl959`
references and `require()` returns a live `registerSteps`.

### Check 9 — a stale build, not a defect

The unit file initially failed 9/13 with `projectNotDoneEta is not a function`. That is
the gitignored `out/` being stale, not a defect: the tests import from `../out/...`, and
`npm run compile` turns it green at 13/13. Recording it because "9 failing tests" is
exactly the shape that gets misread as a bounce.

### Check 16 — co-change

Partners: the unit test (5), `render-briefing-burndown.ts` (3), the chart (2), the
property test (2), `index.js` (2). All moved with the parcel except
`render-briefing-burndown.ts` — correctly, because it calls
`computeNotDoneBurndownSeries` (`:42`) and `buildNotDoneBurndownSvg` (`:46`) and so
**inherits** the projection with no edit. That also satisfies `qa_e2e` step 7 (the
briefing PNG shows the same projection) by construction rather than by a second code
path.

### Check 17 — BLOCKED, with a mitigation I verified rather than accepted

Both suites are BLOCKED BY concurrent load: QA is running the full suite (load average
**152**, 9 live vitest processes), and the engineering rule forbids running tests
concurrently. Not run, and not recorded as passing.

The cleaner's static mitigation was a name-grep. I verified it and then went further,
because a name-grep would miss a layout/snapshot coupling to the new `<text>` line:

- Neither file references `etaDays`, `projection`, `Projected clear`, `no ETA` or
  `projectNotDoneEta` (0 hits each); repo-wide, only the two BL-910 test files do.
- `renderBriefingBurndownCli.test.js` asserts **only** diagram count, diagram name and
  PNG magic bytes — no SVG content, no snapshot, no layout assertion. The added line
  structurally cannot break it.
- `gitHistoryAdapter.test.js` is not on the rendering path at all.

## Verdict

**PASS.** Zero defects, nothing to bounce, nothing to record in the bounce log. The
human's hard condition is enforced by the type rather than trusted to a branch, the
cleaner caught and correctly fixed a genuine invariant-2 violation that I re-derived
independently, and both properties bite. Forwarding to the hardener under the same task
name, with two items for that stage: strengthen the invariant-2 generator toward
exactly-dividing pairs, and pick up the two load-blocked suites once the box is quiet.
