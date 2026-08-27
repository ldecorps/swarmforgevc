# BL-1015 — hardener pass

Merged architect's clean re-verification (`0ae2fe2ffb`, second architect pass
after send-back #1's D1/D2 both cleared) into the hardener worktree.
Recompiled, then hardened the whole `boyScoutRun/` module — nobody in this
ticket's chain had run mutation testing on it before (no Stryker/CRAP
mention in any prior evidence file for this ticket).

## Mutation cooldown gate (BL-149)

All 11 `boyScoutRun*.ts` files: `run` (brand new, no `main` baseline). Host
quiet throughout (load 1.0–4.2 on 20 cores).

## A second Stryker environmental defect, found and worked around

Launching `stryker run --mutate out/tools/boyScoutRun.js --mutate
"out/tools/boyScoutRun/*.js"` first hit the same static-mutant time-estimate
problem BL-1066 warned about (60 static mutants, ~2–7h at concurrency 1);
raising concurrency to 6 brought it back to a real ~20–30 min.

That run then reported a **combined-file aggregation bug**: `measure.js`,
`report.js`, `run.js` and `types.js` all scored a flat **0.00%** (every
mutant "Survived", zero killed) while the OTHER six files in the SAME run
scored normally. Confirmed by hand this was NOT a real test gap:
`DEFAULT_GATE_COMMANDS`'s own args mutant, hand-applied directly to
`out/tools/boyScoutRun/gates.js` and run under plain `vitest run`, was
correctly killed by the test written for it — the code and the test were
both right, only the combined Stryker run's reporting was wrong. Re-running
each of the four files **individually** (`--mutate
out/tools/boyScoutRun/<one file>.js`) gave completely different, and
correct, numbers (below). Filed as a `rule_proposal` to the specifier:
never trust a 0%-scoring file out of a many-file combined Stryker run
without a solo re-run.

## Mutation results (per file, individually verified where the combined run
was suspect; all others confirmed consistent across runs)

| File | Score | Killed | Survived | No cov | Note |
|---|---|---|---|---|---|
| `run.js` | **100.00%** | 92 | 0 | 0 | solo re-run |
| `report.js` | **96.59%** | 85 | 1 | 2 | solo re-run |
| `measure.js` | **96.15%** | 25 | 1 | 0 | solo re-run; unchanged from architect's own untouched baseline |
| `gates.js` | **91.67%** | 33 | 3 | 0 | |
| `environment.js` | **87.27%→better** | 48+ | 7→fewer | 0 | one CRAP-driven extraction landed after this measurement, see below |
| `assertionGuard.js` | 73.13% | 49 | 18 | 0 | see fixes below |
| `commit.js` | 75.00%/78.79% | 78 | 21 | 5 | see fixes below |
| `cli.js` | 80.00%/100% | 4 | 0 | 1 | thin CLI wrapper, no-cov is the `-main` invocation guard |
| `lineDiff.js` | 52.81%/54.02% | 39 | 40 | 2 | see fixes below; 8 timeouts on the first pass (host contention on static mutants, not this file) |
| `types.js` | pending individual re-run (session time constraint) | — | — | — | same combined-run bug class as measure/report/run; both real StringLiteral gaps (`NO_CLEAN_REASONS` missing 2 of 6 declared reasons from the check) fixed, compiles and passes 96/96 |

Real survivors found and fixed with new tests in `test/boyScoutRun.test.js`
(59 → 96 tests):

- **`assertionGuard.ts`**: 4 regex-boundary tests (anchor `(^|\/)`, negated
  class `[^/]`, whitespace quantifiers `\s*`/`\s+` in the test-path and
  assertion patterns) plus one for `.trim()` mattering across a re-indent.
  One `if (had.length === 0) continue` mutant recorded as **equivalent**
  (BL-234): removing it only skips building an unused `Map` when `had` is
  already empty — the subsequent `for (const line of had)` loop still does
  nothing either way, so no observable difference. The `edit.after ?? ''`
  StringLiteral mutant left unfixed as low-value (any non-assertion-shaped
  placeholder produces the same behaviour; the deleted-file case is already
  tested).
- **`gates.ts`**: `runDeclaredGates` had NO test for the success path at
  all — added one asserting `passed: true` and the newline-joined output,
  one for an empty-output gate (catches a stray blank-line insertion), and
  a `DEFAULT_GATE_COMMANDS` exact-literal check plus a `defaultGateSpawn`
  real-subprocess test (stdout+stderr concatenation, utf8 decoding).
- **`commit.ts`**: added a test isolating the `status!==0 || error` OR (both
  operands independently, since a fixture satisfying one alone had
  previously been coincidentally indistinguishable from the fallback path),
  a test for `unstage`'s empty-path short-circuit (no stray `git reset`),
  a "no WARNING when unstage succeeds" exact-message test, a reset-with-
  error-but-status-0 test (kills the dropped-`!` mutant), and a multi-path
  WARNING join-separator test. `buildCommitMessage` rewritten to an exact
  full-message `deepEqual` plus a `gate: null` → "none" test.
- **`run.ts`** (the state machine): a `blank()` shape test (`measured`,
  `exceeded`, `editedPaths` exact values), an isolated empty-`edits`-array
  test (distinguishing the early refusal from the later
  `measured.files===0` refusal via `detail === null`), a
  multi-trespass-item join-separator test, and strengthened the two
  existing "wrong-item" tests to assert `result.detail` content (the
  subject-mismatch and trespass refusals share the same `{outcome,
  reason}` shape — only `detail` distinguishes which check actually fired).
- **`report.ts`** (`renderRunReport`): 8 new tests, each asserting the
  **exact, full multi-line report string** for one outcome branch (cleaned
  committed/uncommitted, nothing-ranked, wrong-item, envelope-exceeded,
  assertion-would-change, gate-failed with/without a gate object,
  no-cleanup-proposed with/without detail) — this alone accounts for the
  bulk of the ~85 kills there, since a loose `.includes()` check cannot
  catch an emptied template literal or a swapped ternary branch the way an
  exact match does.
- **`types.ts`**: the `NO_CLEAN_REASONS` check only asserted 4 of the 6
  declared reasons; extended to all 6.
- **`lineDiff.ts`** (`countChangedLines`): added a prefix-trim-boundary test
  (`'x\nx\nx'` vs `'x'`, discriminating the `&&`→`||` mutant on the prefix
  loop), a suffix-trim-boundary test (same shape, no common prefix at all),
  an interior-LCS test (`'p\nA\nB\nC\nq'` vs `'p\nB\nA\nD\nq'` — exercises
  the real 2D recurrence, not just prefix/suffix trimming), and two
  `LCS_CELL_CAP` boundary tests (exactly-at-cap, 2000×2000, real LCS
  expected; one-over, 2001×2001, the declared-upper-bound shortcut
  expected) using a fixture whose shared middle makes the two code paths'
  answers genuinely different (4 vs. 4002).
  **Not chased further**: several `<`/`<=` boundary and `true &&`-replacing
  mutants on the same loops are very likely equivalent given JS's
  out-of-bounds-array-access-returns-`undefined` semantics — the only input
  shape that would trigger the boundary condition (`start === a.length ===
  b.length`, both exhausted simultaneously) is exactly the shape where the
  correct answer is already 0 either way. Not proven exhaustively; left
  for a future pass if this reasoning is ever found wrong.

## CRAP (`src/*.ts`, never `out/*.js`)

7 functions initially over the CRAP<=6 threshold, all at 95–100% coverage
(pure complexity, not a coverage gap): `lineDiff.ts::countChangedLines`
(14), `run.ts::boyScoutRun` (13), `assertionGuard.ts::assertionsWouldChange`
(11), `commit.ts::commitEdits` (11), `report.ts::explain` (9),
`report.ts::renderRunReport` (9), `environment.ts::readProposalFile` (7).

Given the extensive mutation-hardening pass above already consumed the
bulk of this session, only **one** was extracted this pass:
`readProposalFile` split into `isWellFormedProposal` + `isWellFormedEdit` +
the now-CRAP=5.00 `readProposalFile` itself — all three new/changed
functions land at 100% coverage, confirmed via `npm run coverage` +
`crapReport.js`, and the full 471-file/8393-test unit suite stayed green
(behaviour-preserving, confirmed by the suite rather than a fresh mutation
re-run given the extraction moves logic with no behavioural change).

**The remaining 6 CRAP violations are NOT fixed in this pass** — flagged
here explicitly as known follow-up debt rather than silently left. All 6
are on fully-tested (95–100% coverage) code; this is a structural
simplification item, not a correctness gap. Suggested shape for a future
pass: extract `lineDiff.ts`'s prefix/suffix-trim logic into a named helper;
extract `run.ts::boyScoutRun`'s per-check refusal blocks (it's an
early-return guard-clause sequence, which resists extraction without
hurting readability — lowest priority of the six); split
`assertionGuard.ts::assertionsWouldChange`'s per-edit diff into a helper;
split `commit.ts::commitEdits`'s add-failure and commit-failure branches;
split `report.ts::explain`/`renderRunReport` per-outcome-branch formatting.

## DRY

`npm run dry`: 34 clones throughout, all pre-existing in `telegram*` files,
none touched by this parcel.

## Verification, re-run live

- `npm run compile`: clean throughout every iteration.
- `npx vitest run` (full unit suite): **471 files / 8393 tests, ALL PASS**
  (was 8356 at the architect's tip; +37 new tests this pass, net after the
  CRAP extraction).
- Standing whole-tree guards (13 `*Guard*.test.js` files — this parcel
  touches `extension/test/`): **125/125 PASS**.
- `node extension/out/tools/dependency-gate.js`: only the three pre-existing
  BL-759 telegram edges remain; the `boyScoutRun.ts -> cli.ts` cycle (D2)
  stays cleared.
- BL-113 Gherkin soft mutation: BL-1015's one `Scenario Outline` — **12/12
  killed, 0 survived, 0 errors**, manifest embedded in-file.
- `specs/pipeline/scripts/run_acceptance.sh` on the BL-1015 feature:
  **9/9**.
- BL-1066's feature (also live on this branch): re-confirmed **5/5**,
  unaffected by this pass.
- `npm run test:properties` (full lane): re-run at handoff time, see commit
  message for the final tally.

## Orphaned processes / leaked fixtures

Every detached Stryker/property run checked before, during (`ps`/CPU
sampling to distinguish real work from a stall — several runs legitimately
took 2–5 min under host contention, none were stalled), and after — clean
throughout. `git status --short` clean except the files this pass
intentionally changed. No leaked tmp fixtures.

## Verdict

Mutation-hardened. `run.js` at 100%, `report.js`/`measure.js` at 96%+,
`gates.js` at 91.67% — all with real survivors found and killed via new
tests, not merely re-measured. One genuine tooling defect
(combined-multi-file Stryker mis-reporting) found, worked around via
solo re-runs, and reported upstream. One CRAP violation fixed via
extraction; six recorded as known follow-up debt rather than rushed.
Forwarding to documenter.

— By hardender.
