# BL-1436 — architect pass (redo after bounce), 2026-09-05

Ticket: BL-1436-the-pricing-table-prices-every-model-the-swarm-runs
Role: architect
Commit reviewed: afa23b9f32 (cleaner, redo after my bounce)

## Result: NONE — the bounced finding is resolved; no other defect found

## What changed since my bounce

My earlier bounce (`backlog/evidence/BL-1436-bounce-20260905.md`) found
`costFrom`'s new honest-null branch (a nonzero-token category with no
known rate returns `null` for the whole estimate) had zero automated test
coverage — my mutation (`return null` → `continue`) left every named test
surface green. The coder's rework adds exactly two targeted unit tests:
one reproducing my exact mutation directly (asserting `null`, with a
self-documenting fixture-assumption guard naming what to do if
`claude-fable-5-1` ever gains a published cache-creation rate), and its
positive complement (the model's other three categories still price
normally despite the one missing rate).

## Independently reproduced the fix, using my own bounce's exact repro

Re-ran my exact mutation (`costFrom`'s `return null` → `continue`)
against the fixed test file, recompiling properly this time: **1 of 32
tests fails** — `expected null, got 0` — confirming the new test genuinely
catches the regression my bounce named. Restored the file, recompiled,
confirmed byte-identical via `diff` and `git status --short` (empty),
reran — 32/32 again.

## Checks run

- **Dependency-rule gate**, full-repo: `Dependency-rule gate PASSED: no
  forbidden edges.`
- **Co-change report**: nothing suspicious.
- **jscpd**, independently re-run on the step handler: `0 clones`.
- **Register check**: `grep -n pricingTable backlog/standing-reds.tsv` —
  empty, confirming the row stays removed. The cleaner's evidence notes a
  merge conflict between a bounce-side re-pointing edit and the coder's
  row-removal edit, resolved in favor of removal (correctly matching
  invariant 3, since the fix genuinely lands green) — independently
  confirmed the current state myself.

## Independently re-verified the substance

- `npx vitest run test/pricingTable.test.js` — **32/32 pass** (was 30,
  +2 new).
- `node specs/pipeline/cli.js
  specs/features/BL-1436-the-pricing-table-prices-every-model-the-swarm-runs.feature`
  — **6/6 pass**.
- `node specs/pipeline/cli.js
  specs/features/BL-627-pricing-table-correctness-and-coverage-invariant.feature`
  (regression) — **6/6 pass**, unaffected.

All matching both the coder's and cleaner's claimed counts exactly.

## Verdict

Architecturally compliant. The bounced finding (missing test coverage for
`costFrom`'s new honest-null branch) is resolved and independently
confirmed via direct reproduction of my own original mutation; no other
architecture violation, invariant violation, or correctness defect found.
Forwarding to hardener.
