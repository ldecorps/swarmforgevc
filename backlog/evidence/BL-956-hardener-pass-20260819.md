# BL-956 hardener pass — 2026-08-19 (second pass, after my own bounce)

Parcel: `BL-956-pipeline-board-caption-and-cap-hotfix`, received from
architect at `58632c3221`. This is the pass over the REBUILD that answers
my earlier bounce (`backlog/evidence/BL-956-hardener-bounce-20260819.md`,
D1 — the live HTML surface silently dropped the collapsed-epics cap).

Outcome: **FORWARD to documenter.** No new defects. One CRAP regression
found and fixed here (see §4), two mutation gates recorded as deferred
with no verdict (see §5).

---

## 0. Lineage repair before any gate ran

The 3-way merge of the coder's re-fix silently re-applied MY OWN prior
scoped revert's deletion of the `bl956PipelineBoardCaptionCapSteps` line
from `specs/pipeline/steps/index.js` — the merge base still had it, my
revert removed it on this branch, and the re-fix branch never touched
that file, so the merge correctly propagated my removal forward with no
conflict marker. Restored in `ab6eaa6f9`. This is exactly the BL-954
hazard class.

Verified the merge dropped nothing ELSE: `git diff 58632c3221..HEAD` over
the five other files my revert had touched (`pipelineBoard.ts`, the
property test, `pipelineBoard.test.js`, the feature file, the step
handler) is empty — they match the sender's tip byte for byte.

## 1. D1 is fixed, re-reproduced live (not assumed)

Same probe that FOUND the defect, re-run against the rebuilt `out/`:
5 epic-tracker paused items against `PIPELINE_BOARD_COLLAPSED_EPICS_MAX = 3`.

```
collapsedEpics.length: 3
collapsedEpicsOmittedCount: 2
LIVE HTML contains "more epics"?   true      (was FALSE at the bounce)
plain body contains "more epics"?  true
```

`buildPipelineBoardHtml` now computes `epicsOverflow` exactly as it
computes `parkedOverflow` and passes it into `renderParkedSectionHtml`,
whose signature gained the parameter.

The regression guard is non-vacuous and covers the right surface: the
property test asserts all three caps (`more parked` / `more epics` /
`more active`) against BOTH `renderPipelineBoardBody` and
`composePipelineBoardHtml(...).html`, with a matching
`assert.doesNotMatch` on the no-overflow side. The acceptance step for
`And a line reads "<overflow>"` asserts the live HTML too, not only the
plain body that the bounce showed every test layer had been checking.

## 2. Rebuild bookkeeping the specifier's amendment required

- `specs/features/BL-956-pipeline-board-caption-and-cap-hotfix.feature`
  is live; no `.feature.draft` remains.
- The ticket's `acceptance:` points at the `.feature`, not the draft.
- `bl956PipelineBoardCaptionCapSteps` registered at
  `specs/pipeline/steps/index.js:519`, exactly once; `node --check` clean.

## 3. Checks run — complete inventory, run-or-blocked

| Check | Result |
|---|---|
| `pipelineBoard.test.js` + `pipelineBoardSync` + `pipelineBoardPinSync` + `conciergeTick` | **290/290 pass** (`conciergeTick` 111/111 — out of scope per the ticket, confirmed not regressed) |
| Standing whole-tree guards (7 `*Guard*.test.js`) | **51/51 pass** — mandatory because this parcel adds a file under `specs/pipeline/steps/` and touches `extension/test/` |
| Acceptance `BL-956-…feature` | **6/6 pass** (re-run after my §4 change) |
| Property lane (`bl956PipelineBoardCaptionCapInvariants`) | **3/3 pass** (re-run after §4) |
| CRAP | regression found and fixed — §4 |
| DRY (`jscpd`) | **improved** vs `origin/main`: 3 clones / 2.16% lines / 3.61% tokens, against a baseline of 3 clones / 2.28% / 3.95% |
| Stryker mutation | **DEFERRED, no verdict** — §5 |
| Gherkin acceptance mutation (BL-113) | **STALLED, no verdict** — §5 |
| BL-788 bridge-handle pre-check | clean — the step file starts no bridge at all |
| Fixture-dir leak pre-check (2026-08-18 rule) | N/A — the step file creates no fixture dir; its three `throw`s have nothing to clean up |
| Orphan process check | clean before and after; the killed mutation run reaped by process group, no leaked `*.property.test.js` |
| Prior-QA-bounce check against `main` (BL-340) | `main` 3 ahead of `origin/main`, read the fresher; BL-956 on `main` carries no `bounce_history` — the only bounce is my own, verified fixed above |
| Landed-since-merge-base check (BL-343) | 5 commits, all ticket/bookkeeping — no bounce fixes to carry, no code |

Acceptance was run against a FRESHLY COMPILED `out/` both times (BL-497).

## 4. CRAP regressed — found, fixed, verified

The parcel raised cyclomatic complexity by +3 in each of four functions,
all of which were ALREADY above the CRAP-6 threshold on `origin/main`
(pre-existing debt the parcel inherited rather than created — but it made
each one worse):

| function | `origin/main` | as received |
|---|---|---|
| `renderParkedSectionHtml` | 12 | **15** |
| `renderParkedSection` | 8 | **11** |
| `buildPipelineBoardHtml` | 9 | **12** |
| `renderBodySections` | 8 | **11** |

The +3 was the same shape in each: two copies of an emptiness guard that
grew a fourth clause, and two copies of the `epicsOverflow` ternary. Both
duplicated across the plain-text path (the change-detection content
signature) and the HTML path (the live message) — the very pair whose
drift WAS D1.

Fixed by extraction — behaviour-preserving, three new module-private
helpers, no test changed (the BL-866 pattern: extract before measuring,
so new code carries its own isolated number):

- `parkedOverflowLineFor(data)` / `epicsOverflowLineFor(data)` — the two
  overflow computations, now shared by both render paths.
- `parkedSectionIsEmpty(...)` — the guard, now shared by both parked
  renderers.

Result: every one of the four is now **at or below its pre-parcel score**,
and the file's flagged-function count drops from 10 to 7.

| function | `origin/main` | after fix |
|---|---|---|
| `renderParkedSectionHtml` | 12 | **10** |
| `renderParkedSection` | 8 | **6** |
| `buildPipelineBoardHtml` | 9 | **6** |
| `renderBodySections` | 8 | **5** |
| `parkedSectionIsEmpty` (new) | — | 4 |
| `parkedOverflowLineFor` (new) | — | 3 |
| `epicsOverflowLineFor` (new) | — | 3 |

All 7 functions still flagged were verified individually against
`origin/main` as **unchanged pre-existing debt** — the parcel introduces
no new flagged function. All 290 unit tests, 6/6 acceptance and 3/3
property still pass after the extraction.

## 5. Two mutation gates carry NO verdict — deferred, recorded in the ledger

Both rows are in `backlog/hardening-debt-ledger.yaml`, written by
`hardening_debt_ledger_update.bb --defer` (never hand-edited). Neither is
a pass; neither is a fail.

**Stryker (`extension/src/concierge/pipelineBoard.ts`)** — the project's
own cooldown gate declined it before host load even mattered:

```
DECISION: skip-cooldown
file_age_days: 0.47 (cooldown: 3 days)
load_avg: 85.56 cores: 4 busy_threshold: 2.00x (busy)
```

Per BL-149 a `skip-cooldown` file is skipped unconditionally. Host load
was independently disqualifying anyway (85–145 on 4 cores, 21×–36× the
core count, well past the 2× ceiling).

**Gherkin acceptance mutation (BL-113)** — attempted, stalled, killed.
The feature has a `Scenario Outline`, so BL-638's `inapplicable` does not
apply; this gate was genuinely owed. The run sat at
`status total=6 completed=0 running=0` for 2.5 minutes with
`bb gherkin-mutator` at 0.14s and `mutationWorker.js` at 0.10s of CPU —
flat, the BL-687 signature. Killed by process group, reaped clean, feature
file unchanged, no fixture leaked.

Per my own BL-687 rule I checked the harness before writing it off as
weather: the BL-788 pre-check is clean on evidence — this step file
starts no bridge at all, so there is no cross-step handle to leak. That
rule then says a second flat-CPU stall on a clean-pre-check feature is a
TOOL DEFECT to ticket rather than defer. **I am deliberately not filing
that ticket here**, because the load confound is far stronger than it was
for BL-687: BL-687 stalled at load 4–30 on 4 cores, this stalled at
96–145. Escalating on this evidence would file weather as a defect. If
the next stall with this signature happens on a quiet host, that is the
one to ticket.

What this costs, stated plainly: the acceptance-mutation gate did not run
for this parcel, so nothing has proven that scenario 04's `<kind>`,
`<count>` and `<overflow>` example values are load-bearing. I read the
step handler for the BL-908 failure mode instead and it is
mutation-tight by construction, though unproven by execution: `<kind>`
keys directly into `PARKED_KINDS` and an unknown token throws;
`<count>` is validated against an explicit `KNOWN_COUNTS` set; and
`<overflow>` is asserted as a literal against both render surfaces. There
is no shape-lookup branch for a mutant to hide behind.
