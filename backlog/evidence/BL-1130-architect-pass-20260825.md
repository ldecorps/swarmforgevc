# BL-1130 — architect pass — 20260825

**Tip:** cleaner `3f240f7125` (coder `a3c4429c42` + DRY refuse strings)
**Handoff:** `50_20260825T122307Z_000795_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

`origin/main...3f240f7125` = **15 paths**. Hitchhike CLEAN of foreign tickets.
Includes intentional BL-1118 APS assert update for `:refuse-rematch` vocabulary
(companion to the same absorb helper — not a stacked foreign tip).

## Architecture

- Pure `automated-absorb-plan` / `post-absorb-clean?` /
  `absorb-outcome-names-rematch-or-refuse?` in `master_main_reconcile_lib.bb`
- `handoffd` + `post_hotfix_merge_origin{,_lib}` own git I/O (merge-tree
  foresight, abort, surface) — policy stays inward
- BL-1120 foreign-merge skip preserved (`merge-attempt-plan` still first)
- No extension/webview; integrate-not-fork. Dep-gate N/A (Babashka parcel).
  Standing extension debt previously tracked as BL-759 is landed; not re-opened.

## Invariants (2 declared) — encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Automated absorb never leaves MERGE_HEAD + unmerged paths | `post-absorb-clean?` + property runner | ALL TESTS PASSED |
| 2 | Conflict → clean refuse (abort + rematch/refuse), never editor recovery | `absorb-outcome-names-rematch-or-refuse?` + refuse surfaces | property + APS |

`bl1130_absorb_plan_property_runner.bb` → ALL TESTS PASSED  
`master_main_reconcile_lib_test_runner.bb` → ALL TESTS PASS  
`post_hotfix_merge_origin_lib_test_runner.bb` → ALL TESTS PASSED  
Acceptance BL-1130 **2/2**; BL-1118 companion **4/4**.

## Property-testing support (undeclared)

Declared babashka property covers the absorb-plan surface. No additional
fast-check module. No new property authored this pass.

## Correctness

Conflict foresight → `:refuse-rematch` before starting merge; conflict after
start aborts and surfaces rematch (no “finish in an editor”). No defect spotted.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1130-land-on-main-without-external-conflict-resolution`, commit = this tip.
Authorize BL-1130 paths (+ intentional BL-1118 APS companion lines only).

By architect.
