# BL-1120 — architect pass (rematch tip) — 20260825

**Tip:** cleaner `b157dc6de1` (coder rematch `5411d2a09` on `origin/main`=`4633d9bf42`)
**Handoff:** `00_20260825T113550Z_000791_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

`origin/main...b157dc6de1` = **16 paths**, BL-1120-only. Hitchhike CLEAN.
Foreign-merge abort guard in `master_main_reconcile_lib.bb` + thin
`handoffd` wiring; APS; babashka property + unit runners; how-to/Spec/index
(docs already on rematch tip — documenter may still polish).

## Architecture

- Pure predicates `may-abort-failed-merge?` / `merge-attempt-plan` in lib;
  handoffd owns git I/O (`MERGE_HEAD` probe, merge, conditional abort).
- Policy independent of UI; integrate-not-fork; no extension/webview surface.
- Dependency gate N/A for Babashka parcel (no extension TS in tip). Standing
  extension `acyclic` debt remains **BL-759** (out of parcel).

## Invariants (2 declared) — encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Pre-existing MERGE_HEAD → never `git merge --abort` | `merge-attempt-plan` + `may-abort-failed-merge?` false; property runner | ALL PROPERTIES HOLD |
| 2 | Only tick-started merge may abort on failure | `may-abort-failed-merge? true` only when tick started; handoffd calls abort only after plan `:run-merge` | property + APS scenario 2 |

`bb …/bl1120_foreign_merge_abort_property_runner.bb` → ALL PROPERTIES HOLD.
`bb …/master_main_reconcile_lib_test_runner.bb` → ALL TESTS PASS.
Acceptance feature → **2/2 PASS**.

## Property-testing support (undeclared)

Declared invariants already cover the pure merge-plan surface. No additional
fast-check module in this parcel. No new property authored this pass.

## Correctness

Live `master-main-reconcile-merge!` skips when plan is
`:skip-human-merge-in-progress` and only aborts when
`may-abort-failed-merge? true` after this tick started the merge. No defect
spotted.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1120-handoffd-must-not-abort-foreign-merge`, commit = this 1120-only
evidence tip. Authorize BL-1120 paths only.

By architect.
