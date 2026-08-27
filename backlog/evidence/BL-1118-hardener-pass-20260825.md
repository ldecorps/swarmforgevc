# BL-1118 — hardener pass — 2026-08-25

Architect tip: `2d7f707722` (recreated `swarmforge-hardender`).

## Scope

- `swarmforge/scripts/post_hotfix_merge_origin_lib.bb` (+ thin CLI)
- APS steps: exact Examples prose for outcome / mergeability / exit
- Feature soft Gherkin stamp

## Gates

| Check | Result |
|---|---|
| Unit lib runner | ALL PASS |
| Property honesty grid | ALL PASS |
| Acceptance | **4/4** |
| Surgical lib mutants | **6/6 killed** (honest clear/always-nil; plan always-noop/attempt; conflict regex; skip-abort) |
| Gherkin soft | **6/6 killed**, stamped |
| CRAP / Stryker TS | N/A (Babashka parcel) |

## Notes

Soft survivors were case-mutants of Examples cells; steps now require exact
`conflict-free` / `path-conflicting`, exact outcome whitelist, and numeric
`:exit` equality with the example column.

Forward authorizes **BL-1118 paths only** (stacked hitchhike ancestry).

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-1118-post-cursor-batch-merge-origin-main`, commit = this tip.

By hardener.
