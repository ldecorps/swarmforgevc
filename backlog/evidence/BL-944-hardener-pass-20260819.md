# BL-944 hardener pass — 2026-08-19

## Reviewed commit
`4e1ded9b94` ("BL-944: architect pass - both invariants hold, add property
coverage for directLoadFileDeps"), merged into hardener as this parcel.

## Tooling scope check
No `extension/src/*.ts` touched (`git show --stat` on both coder commits
names only `specs/pipeline/steps/lib/`, `extension/test/`, and
`specs/pipeline/steps/*.js` — confirmed by the architect and re-confirmed
here). Stryker/CRAP/DRY inapplicable, same as the rest of this batch.

## Checks run (complete inventory, not first-failure-stop)

1. **Host load / BL-149 cooldown gate**: load averages 20–29 on 4 cores —
   the busiest this pass has seen all session. All 6 changed files
   reported `DECISION: skip-busy` except `index.js` (`skip-cooldown`, age
   0.03 days). **BL-113 Gherkin mutation over the feature's Scenario
   Outline (scenario 02, 3 Examples rows) deferred to the next quiet
   pass** — gate-driven, substantially offset by item 4 below (the
   architect's own by-hand mutation of the live list, which is exactly
   what an invariant-2 Gherkin mutant would exercise) and by my own
   independent closure computation (item 5).
2. **Independent re-run of both test files**:
   - `npx vitest run test/operatorRuntimeBbFixtureClosure.test.js` —
     **6/6 pass** (the standing closure-honesty guard).
   - `npx vitest run --config vitest.properties.config.mjs
     test/operatorRuntimeBbClosure.property.test.js` — **2/2 pass**.
3. **Acceptance, independently re-run**:
   - This ticket's own feature — **6/6 PASS**, matching
     `qa_e2e_procedure` step 3 exactly.
   - `specs/features/BL-647-rotation-router-liveness.feature` — **7/7
     PASS**. This is the feature the ticket's own description names as
     100% broken (0/7) before the fix — direct, first-hand before/after
     confirmation against the actual originally-failing scenarios named
     in the ticket, not merely a synthetic reproduction.
4. **Leftover process/fixture check**: no stray `node --test`/`stryker`
   process from my own runs (other worktrees' own concurrent test
   processes left untouched); no stray tmux servers; `git status --short`
   clean.
5. **Independent invariant-1 verification against real, current source**
   (own hardening judgment, beyond re-running the existing suites):
   loaded `operatorRuntimeBbFixtureFiles.js` and
   `operatorRuntimeBbClosure.js` directly in a throwaway `node -e` and
   called `diffClosureAgainstList('swarmforge/scripts', 'operator_runtime.bb',
   OPERATOR_RUNTIME_BB_FILES, OPERATOR_RUNTIME_BB_DECLARED_EXTRAS)` against
   this worktree's real, current `swarmforge/scripts/` tree (not a
   fixture copy) — **closure size 28, list size 28, `missing: []`,
   `extra: []`**, exactly matching the ticket's own "the closure is 28
   files" measurement, computed independently rather than trusted from
   either the ticket text or the architect's report.
6. **`LOAD_FILE_RE` soundness spot-check**: grepped every actual
   `(load-file ...)` call site across `swarmforge/scripts/*.bb` (as
   opposed to prose mentioning "load-file" in a comment) for a
   non-literal target — zero found; every real call site uses the
   identical `"NAME.bb"` string-literal idiom the module's own header
   claims is universal in this codebase. Confirms the regex-based
   extraction has no blind spot for a dynamically-constructed filename
   that would silently escape detection.
7. **Required wiring (ticket YAML)**: both items confirmed by direct
   grep — `mono_router_lib.bb` present in `OPERATOR_RUNTIME_BB_FILES`
   (the first missing dependency, as required); the closure guard test
   lives at `extension/test/operatorRuntimeBbFixtureClosure.test.js`
   (the standing per-parcel suite location), not under
   `specs/pipeline/test/`.
8. **Surfaced defect D1 (`role_lifecycle.sh` unpark path)**: already
   independently reproduced and correctly routed by the architect
   (verified sent to specifier/coordinator); out of this parcel's own
   scope per the ticket's own constraints. Not re-litigated here.

## Outcome
No defects found. No applicable Stryker/CRAP/DRY tooling. BL-113 Gherkin
mutation deferred per the BL-149 cooldown gate (host at its busiest this
session) — offset by the architect's own by-hand list mutation and my own
independent, from-scratch closure computation against real current
source, both confirming invariant 1 holds exactly (28/28, zero drift).
Direct before/after confirmation against the actual originally-failing
BL-647 feature (0/7 → 7/7). Both required-wiring items and invariant 2's
`operator_ask.bb` disposition independently re-confirmed.

Forwarding to documenter.

By hardener.
