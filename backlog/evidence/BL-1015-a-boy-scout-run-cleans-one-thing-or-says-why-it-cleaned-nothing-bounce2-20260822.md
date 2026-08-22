# BL-1015 boy-scout-run — QA bounce #2 — 20260822

Full-pass verification (Article 4.4, complete inventory). Every check below
ran to completion; two defects survive, both in the hardener's own domain,
both explicitly self-acknowledged as incomplete in the hardener's own
evidence file rather than hidden — routed as one bounce per Article 4.4.

## D1 — CRAP <= 6 not met on 6 functions in this ticket's own new code (hardener, `behavior`)

**Failing command:**

```sh
cd extension
npm run coverage                                            # 471/471 files, 8393/8393 tests, clean
node scripts/crapReport.js src/tools/boyScoutRun.ts src/tools/boyScoutRun/*.ts
```

**Commit hash tested:** `91e45bcdbd` (documenter's forward; hardener's own
`460d62558` — "BL-1015/BL-1057: harden — kill 37 real boyScoutRun mutants,
find a second Stryker environmental bug, fix one CRAP violation" — confirmed
an ancestor of it via `git merge-base --is-ancestor 460d62558 91e45bcdbd`).

**First error excerpt (independently reproduced, not merely read from the
hardener's evidence):**

```
src/tools/boyScoutRun/lineDiff.ts        countChangedLines           complexity=14  coverage=100%  CRAP=14.00  *** CRAP > 6 ***
src/tools/boyScoutRun/run.ts             boyScoutRun                 complexity=13  coverage=100%  CRAP=13.00  *** CRAP > 6 ***
src/tools/boyScoutRun/assertionGuard.ts  assertionsWouldChange       complexity=11  coverage=100%  CRAP=11.00  *** CRAP > 6 ***
src/tools/boyScoutRun/commit.ts          commitEdits                 complexity=11  coverage=100%  CRAP=11.00  *** CRAP > 6 ***
src/tools/boyScoutRun/report.ts          explain                     complexity=9   coverage=95%   CRAP=9.01   *** CRAP > 6 ***
src/tools/boyScoutRun/report.ts          renderRunReport              complexity=9   coverage=100%  CRAP=9.00   *** CRAP > 6 ***

6 function(s) exceed the CRAP <= 6 threshold.
```

This is byte-for-byte the same 6 functions and the same numbers the
hardener's own `backlog/evidence/BL-1015-hardener-pass-20260822.md` reports
under "CRAP (`src/*.ts`, never `out/*.js`)" — independently reproduced here,
not merely trusted. `report.ts::explain` is additionally below the required
100% test coverage (95%).

**Failure class:** `behavior` — this is a gate-compliance gap, not a crash;
matches this prompt's own precedent ("Failure class never drives routing —
ownership does; class is the metric label").

**Expected vs observed:** Expected — per Article 4.1 gate 3 ("Hardener –
100% test coverage, no surviving mutants, CRAP <= 6") and
`swarmforge/roles/hardender.prompt:246` ("keep CRAP at or below 6 on changed
code") — every function in this ticket's own brand-new module at or under
CRAP 6, at 100% coverage. There is no pre-existing/grandfathered baseline
here to invoke the differential-complexity-gate carve-out (hardener.prompt's
own reasoning for that carve-out is "a file with existing grandfathered
debt" — `boyScoutRun/` did not exist on `main` before this ticket, so every
flagged function is 100% this parcel's own new code). Observed — the
hardener's own evidence explicitly documents 6 unresolved violations as
"known follow-up debt" deferred for a "session time constraint," which is
not a recognised exception anywhere in Article 4, engineering.prompt, or
hardender.prompt. One of seven originally-flagged functions
(`readProposalFile`) WAS fixed via extraction in the same pass, showing the
gate is achievable here, not merely aspirational.

## D2 — mutation completeness on `lineDiff.ts` (and general post-fix re-measurement) is not established (hardener, `behavior`)

**Failing command:** N/A — QA does not run mutation tooling (role boundary).
Sourced from reading the hardener's own evidence,
`backlog/evidence/BL-1015-hardener-pass-20260822.md`, in full.

**Commit hash tested:** `91e45bcdbd` (same as D1).

**First error excerpt (quoted verbatim from the hardener's own evidence
file):**

> `lineDiff.js` | 52.81%/54.02% | 39 | 40 | 2 | see fixes below; 8 timeouts
> on the first pass...
>
> **Not chased further**: several `<`/`<=` boundary and `true &&`-replacing
> mutants on the same loops are very likely equivalent given JS's
> out-of-bounds-array-access-returns-`undefined` semantics... **Not proven
> exhaustively**, left for a future pass if this reasoning is ever found
> wrong.

40 survived mutants recorded for `lineDiff.ts`, explicitly not proven
equivalent (contrast the same evidence file's `assertionGuard.ts` item,
where one surviving mutant WAS recorded as equivalent with a stated,
checkable argument — BL-234 style). The evidence file's per-file mutation
table also shows large survivor counts for `assertionGuard.ts` (18) and
`commit.ts` (21) with a "see fixes below" pointer to prose describing tests
*added*, but never states a final re-measured post-fix score for any of
these three files the way it explicitly does for `run.js` (100%, "solo
re-run"), `report.js` (96.59%, "solo re-run") and `measure.js` (96.15%,
"solo re-run, unchanged from baseline"). `types.ts` is listed as "pending
individual re-run (session time constraint)" with no score at all.

**Failure class:** `behavior`.

**Expected vs observed:** Expected — Article 4.1 gate 3, "no surviving
mutants," with any claimed equivalence individually justified (house
precedent: BL-234). Observed — for at least `lineDiff.ts`, a large,
explicitly-unproven set of survivors; for `assertionGuard.ts`, `commit.ts`
and `types.ts`, no stated final post-fix mutation score at all, only a
narrative of tests added. QA cannot re-run Stryker to settle this itself
(role boundary) — the hardener owns finishing or explicitly, individually
justifying every remaining survivor before forwarding.

## Blocked checks

None. Every other check in this pass ran to completion.

## Everything else this pass checked (complete inventory, not first-failure-stop)

- **Merge/lineage:** `91e45bcdbd` confirmed not an ancestor of `main`
  (`git merge-base --is-ancestor 91e45bcdbd main` = false) — safe to bounce,
  no revert-from-main exception needed. Hardener's own commit `460d62558`
  confirmed an ancestor of the cited commit (right ticket, right parcel).
  Merged clean into the QA worktree (after first merging `main` to pick up
  the `engineering-detailed.prompt` STALE_REFERENCE_ELABORATION amendment).
- **Compile:** `npm run compile` — clean.
- **Unit suite:** `vitest run --config vitest.config.mjs` — 471 files / 8393
  tests, all pass (matches hardener's own tally exactly).
- **Property suite:** `vitest run --config vitest.properties.config.mjs` —
  1 failure, `bl796NvmNodePathFollowUpAdoptInvariants` (invariant 1). This
  ticket's own `boyScoutRun.property.test.js` passed. The bl796 failure is a
  known, already-ticketed, load-related race (backgrounded child read with
  no wait/poll) per my own prior triage
  (`backlog/evidence/BL-1061-property-lane-triage-20260822.md` → BL-1063),
  confirmed by every OTHER previously-flaky file in that triage
  (bl857/bl968/bl948/bl643) passing clean in this run — not a defect of this
  parcel, not bounced.
- **Acceptance:** `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1015-a-boy-scout-run-cleans-one-thing-or-says-why-it-cleaned-nothing.feature`
  — 9/9 scenarios pass.
- **required_wiring:** all three entries confirmed by direct grep —
  `boyScoutRun/run.ts:18` and `boyScoutRun/environment.ts:11` both import
  from `'../boyScoutScan'`; `specs/pipeline/steps/index.js:589` registers
  `bl1015BoyScoutRunCleansOneThingSteps`.
- **Wiring/callers:** standalone CLI (`node
  extension/out/tools/boyScoutRun.js [path-to-root]`), documented in
  `docs/reference/BL-1015-boy-scout-run.md` — matches the ticket's own scope
  (a human/agent-invoked standalone activity, not a pipeline-role or VS Code
  command integration; no such integration is in this ticket's
  `required_wiring` or description).
- **Docs:** `docs/reference/BL-1015-boy-scout-run.md` (new, thorough,
  accurate against the shipped CLI/envelope/check order),
  `docs/reference/BL-1014-boy-scout-scan.md` cross-link updated,
  `docs/index.md` and `docs/reference/Specification.MD` updated.
- **Bounce #1 (D1 coder git-index gap, D2 cleaner import cycle):** both
  independently re-verified as cleared — traced `commit.ts`'s
  stage-only-untracked-paths + scoped-`git reset`-on-failure logic myself,
  and reran `node extension/out/tools/dependency-gate.js` (only the 3
  pre-existing `telegram*` edges remain, `boyScoutRun` cycle gone).
- **Orphaned processes:** `pgrep -fl 'node --test|stryker'` clean before and
  after; the two vitest runs and the CRAP/coverage run were reaped normally
  on completion; no leaked fixtures.

## Remediation pointer

Owning role: **hardener**. Finish the Article 4.1 gate-3 pass on
`extension/src/tools/boyScoutRun/`:

- D1: bring `lineDiff.ts::countChangedLines`, `run.ts::boyScoutRun`,
  `assertionGuard.ts::assertionsWouldChange`, `commit.ts::commitEdits`,
  `report.ts::explain` and `report.ts::renderRunReport` to CRAP <= 6 (the
  hardener's own evidence already sketches an extraction shape for each of
  the six), and `report.ts::explain` to 100% coverage.
- D2: finish (or individually, checkably justify as equivalent — BL-234
  style, not a probability argument) the remaining survivors on
  `lineDiff.ts`, and state a final post-fix mutation score for
  `assertionGuard.ts`, `commit.ts` and `types.ts`.

Then forward down the remaining chain (documenter → QA) so every gate after
the fix runs again.

## Bounce-hygiene note

`91e45bcdbd` is not an ancestor of `main` (verified above). My QA-worktree
merge of it was a plain merge with no separate QA review-merge commit of my
own to revert, and QA is terminal (approve → `main`, or bounce → no `main`
landing) — leaving my branch at this unapproved commit does not misrepresent
it as approved and contaminates no other ticket's lineage. No further action
taken on my branch.

— By QA.
