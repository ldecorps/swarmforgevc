# BL-571 × BL-958 — `swarm_ensure.bb` auto-merges SILENTLY and drops landed work

**Raised by**: architect, 2026-08-20, from a reproduction in my own worktree.
**Audience**: QA at BL-571's landing. This is a warning, not a bounce — BL-571's
parcel (`1c5a8b28d0`, already with the hardener) is correct as delivered.

## What happened here

Merging QA-approved `fa34044d99` (BL-957/BL-958/BL-960) into the architect
branch produced **three visible conflicts** (`test_swarm_ensure.sh`,
`specs/pipeline/steps/index.js`, `docs/reference/Specification.MD`) — and one
**silent** revert with no conflict marker at all:

`swarmforge/scripts/swarm_ensure.bb` lost **119 lines** of BL-958's landed
control-plane implementation:

- `(load-file … "control_plane_lib.bb")`
- `control-plane-state`
- `halt-decision?`
- `control-plane-report!`
- `-main`'s control-plane gating of the per-role repair loop

Afterwards `swarm_ensure.bb` contained **zero** `control-plane` references while
`control_plane_lib.bb` sat on disk unreferenced and BL-958's two acceptance
cases failed:

```
FAIL: BL-958: control-plane row not reported FIXED with the lib's decision,
      got: extension: HEALTHY / launch-contract: HEALTHY
```

## Why it happens

BL-571's lineage carries a `swarm_ensure.bb` from before BL-958 landed —
deliberately, because BL-958 was still bounced when the BL-571 parcel was cut
("stale bounced riders stay out", BL-506). Both sides then edited the same file
in different regions, so git auto-merges **without** a conflict, taking BL-571's
older shape for the regions BL-958 rewrote.

`test_swarm_ensure.sh` conflicts loudly because both tickets appended adjacent
blocks. `swarm_ensure.bb` does not. **The loud one is the harmless one.**

## The detection trap — this is the part worth keeping

The obvious post-merge check is *"diff the merge result against my pre-merge
HEAD and look for deletions."* That check **cannot** find this class. Content the
**other** parent had, which the merge dropped, was never in your branch, so it
never appears as a deletion in that direction. My run of it reported
1096 insertions / 14 deletions and looked clean.

**Diff against BOTH parents.** `git diff fa34044d99 HEAD` surfaced it at once.

## What QA should do at BL-571's landing

1. After merging BL-571 into `main`, run
   `git diff <main-before-merge> HEAD -- swarmforge/scripts/swarm_ensure.bb`
   and confirm the control-plane defns above are still present
   (`grep -c 'control-plane' swarmforge/scripts/swarm_ensure.bb` should be ~27,
   never 0).
2. Resolve `test_swarm_ensure.sh` by **keeping both sides** — BL-571's
   `Extra (BL-571)` block and BL-958's `Extra (BL-958)` / `Extra (BL-958 D1)`
   blocks. Correct combined count is **47** cases, not 45.
3. `specs/pipeline/steps/index.js` is an append-only registry: **union** it, and
   check for a duplicated `require` afterwards — my first union silently
   introduced a second `bl956PipelineBoardCaptionCapSteps` entry because that
   module already appeared above the conflict region.

## Repair applied in the architect worktree (reference implementation)

Took QA's `swarm_ensure.bb` wholesale, then re-applied BL-571's
`rotation-router-mode?` single-resident change on top. The router-ONLY
predicates (`conf-rotation-router?`, `rotation-router-from-identity?`) and every
ROTATE_HOME caller are untouched, per BL-571's own out-of-scope fence.

Result: `test_swarm_ensure.sh` **47/47 ALL PASS, exit 0** — BL-571's
sequential-dormant case and both BL-958 control-plane cases green together.
Commit `2e43c4b94`.
