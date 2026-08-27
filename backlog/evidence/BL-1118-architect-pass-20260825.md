# BL-1118 — architect pass (Article 4.4)

**Date:** 2026-08-25  
**Role:** architect  
**Reviewed tip base:** cleaner `90f13a2594` (+ prior evidence `019f5e2bde`)  
**Arm:** acceptance feature checked out from local `main` onto tip (full `git merge main`
conflicted on APS `index.js`, then a bad merge state briefly flipped the worktree
onto `main` with a destructive index — aborted/recreated on `019f5e2bde`; feature
armed by path checkout only per specifier "no remint").

## Verdict

**Pass** — forward to hardender. Review inventory: NONE (architecture sound;
declared invariants encoded).

## Inventory

| Surface | Status |
|---------|--------|
| `post_hotfix_merge_origin.bb` + `_lib.bb` | on tip |
| Unit runner | ALL PASS |
| Property runner (honesty) | ALL PASS |
| APS steps + index | on tip |
| Feature file | **on tip** (armed from main) |
| how-to BL-848 / BL-891 | name QA role + helper |

Acceptance: **4/4** via `run_acceptance.sh`.

## Declared invariants

1. **QA role not replaced** — how-tos + acceptance scenario 02.
2. **Conflict → abort, print paths, exit non-zero, leave non-merging** — unit +
   acceptance helper path.

## Hitchhike / BL-506

Ancestry stacks unrelated BL-* (thin-main, etc.). Forward authorizes **BL-1118
paths only**. Hardener: recreate on this tip (`checkout -B`), do not mash stacks.

## Specifier note

Full merge-main was attempted; conflict resolved once then hook/catastrophe
forced recreate + feature path arm. Feature content matches main mint; no remint.
