# BL-1112 — architect pass — 20260827

**Received:** `merge_and_process cleaner 00f972b964` (handoff
`00_20260827T142241Z_000027_from_cleaner_to_architect`)
**Merged at:** cherry-picked `00f972b964` → `d26288919`
**Task:** BL-1112-standing-unit-reds-sample-resources-and-stryker-sandbox

## Verdict

**Pass** — forward to hardender. Inventory NONE.

## Parcel intent

Restore green for standing unit reds: `sampleResourcesCli` was sampling 0 roles
when worktree `GIT_DIR` leaked into fixture git calls; stryker sandbox sibling
APS steps needed the same isolation. Cleaner isolates fixtures via
`isolatedEnv()` / `copySeededRepoInto` and clears `GIT_DIR`/`GIT_WORK_TREE`
around in-process `main()`.

## Merge note

Cherry-picked `00f972b964`. Resolved `index.js` conflict — kept
`bl832BubbleHealthTrendsPageSteps` (cleaner tip had dropped it).

## Checks

| Check | Result |
|-------|--------|
| Unit | **30/30** (`sampleResourcesCli.test.js` 9/9, `strykerSandboxSiblingsLib.test.js` 21/21) |
| APS | **6/6** (`BL-1112-standing-unit-reds-sample-resources-and-stryker-sandbox.feature`) |
| Wiring | `bl1112StandingUnitRedsSteps` registered |

## Forward

`git_handoff` → **hardender**, task `BL-1112-standing-unit-reds-sample-resources-and-stryker-sandbox`.

By architect.
