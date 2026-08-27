# BL-1084 — architect bounce — 20260827

- Attempted `merge_and_process cleaner 454ffa1e7a` (re-promotion handoff).
- BL-1084 supersede implementation reviewed on `main`: architecture sound;
  gates already passed QA 20260824 (`8f872a4201`). Core slice has **zero diff**
  vs `main` at cleaner tip — this pass adds evidence only.

## Inventory (one bounce)

### D1 — behavior: polluted cleaner lineage carries sibling hitchhikers

**Evidence**

- Cleaner tip `454ffa1e7a` vs `main`: **73** path delta (22 non-backlog code
  paths), including BL-780 (`mono_router_lib.bb`, `handoffd.bb`,
  `swarmforge.conf`), BL-980 (`pipelineBoard.ts`, elapsed-time tests/steps),
  BL-781 (babysitter deletions), BL-649/664 merge-up residue, BL-1163, and
  other tickets' evidence/features.
- BL-1084 core (`supersede_lib.bb`, `ready_for_next.bb`,
  `test_supersede_guard.sh`, `bl1084SupersedeStopsAtEveryStageSteps.js`,
  feature file, property runner): **0** lines diff vs `main`.
- Architect merge `efb219ad9` inflated delta to **165** paths vs `main`.

**Required remediation**

- Re-deliver BL-1084 **additively** from `main`: cherry-pick evidence-only
  commits onto a `swarmforge-coder` branch whose tip ancestry is current
  `main`, or merge from a cleaner commit whose first parent preserves the full
  tree with no sibling ticket deltas. Verify
  `git diff main..HEAD --name-only` is limited to BL-1084 paths (+ evidence)
  before handoff.

### D2 — behavior: silent reverts vs landed `main` work (BL-571/BL-958)

**Sites (cleaner tip vs `main`)**

- Deletes `swarmforge/constitution/articles/reference/changed-path-unit-test-gate-amendment-2026-08-27.md` (BL-1164 adoption record on `main`).
- Deletes `swarmforge/scripts/babysitter_{lib,assess}.bb` and
  `babysitter_enqueue_wake.sh` (BL-781 scope — must not ride BL-1084).
- Deletes paused backlog/spec paths for BL-1164–1167, BL-596 feature, BL-1163
  intake archive entries present on `main`.

**Required remediation**

- Same as D1: tip must not delete `main`-landed paths. Diff both parents before
  handoff; any deletion of content already on `main` is a stop.

## Architecture / invariants (BL-1084 slice on `main` — not blocking once D1 fixed)

| Check | Result |
|---|---|
| Wiring | PASS — `enforce-supersede-guard!` in `ready_for_next.bb` before dispatch |
| Invariant 1 (stage-independent) | PASS — shared `project-root` store + pre-turn guard |
| Invariant 2 (absent pass / unreadable refuse) | PASS — encoded in property runner + scenario 05 |
| Property tests | PASS — `bl1084_supersede_property_runner.bb` (500 runs) |
| Dep-gate | N/A (babashka/shell/APS) |

## Revert

- Merge `efb219ad9` reverted with `-m 1` in this pass; architect tree restored
  to post-`main`-sync state without polluted cleaner lineage.

By architect.
