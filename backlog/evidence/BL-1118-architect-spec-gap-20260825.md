# BL-1118 — architect disposition: Spec Gap (missing feature on tip)

**Date:** 2026-08-25  
**Role:** architect  
**Tip reviewed:** `90f13a2594` (cleaner rematch after bounce #1)  
**Handoff:** `00_20260825T100953Z_000760_from_cleaner_to_architect_for_architect.handoff`

## Verdict

**Spec Gap** — implementation + APS + unit/property on tip look sound, but
`specs/features/BL-1118-post-cursor-batch-merge-origin-main.feature` is **not in
`90f13a2594`**. Cleaner rematch note is correct. An untracked copy existed on the
architect worktree disk (leftover from an earlier accidental main merge) and made
acceptance appear to pass; that file was removed so tip judgment is honest.

## Tip inventory (BL-1118 surface)

| Area | On tip? |
|------|---------|
| `swarmforge/scripts/post_hotfix_merge_origin.bb` + `_lib.bb` | yes |
| Unit + property runners | yes (ALL PASS) |
| APS steps + index | yes |
| how-to BL-848 / BL-891 updates | yes |
| Feature file | **NO** |

## Invariants (once feature lands on tip)

1. **QA role not replaced** — how-tos name keep `SWARMFORGE_ROLE=QA`. Executable
   encoding is acceptance scenario 02 (needs feature on tip). Not a fast-check
   property; docs+acceptance is the contract.
2. **Conflict → abort, print paths, exit non-zero, leave non-merging** — unit
   runner encodes this with injected merge/abort seams (PASS on tip).

## Architecture notes (non-blocking once feature present)

- Thin CLI + pure lib; reuses `master_main_reconcile_lib` deadlock-clear seams.
- No reset/stash; honesty gate when dirty.
- Property suite covers honesty/dirty refusal (PASS).

## Required next (coder)

1. Land `specs/features/BL-1118-post-cursor-batch-merge-origin-main.feature` on the tip
   (content already on `main` / prior coder work — cherry-pick or recreate tip with feature).
2. Rematch cleaner → architect on tip that includes the feature.
3. Do **not** forward to hardender until feature is in the tip commit.

## Hitchhike

Pattern scan vs `origin/main` CLEAN for foreign hot areas. Tip ancestry still stacks
unrelated BL-* (BL-506). Forward (when feature lands) authorizes BL-1118 paths only.
