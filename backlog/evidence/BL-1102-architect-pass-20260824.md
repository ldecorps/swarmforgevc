# BL-1102 — architect pass (bounce re-fix), inventory NONE — 20260824

Reviewed cleaner `d61e594d93` (batch including hitchhiker strip `332e9d4885`
on coder `31dce875c1` / cleaner `212b012649`) into `swarmforge-architect`.
Ancestry of the tip is confirmed; a prior architect revert of the first
BL-1102 merge (`f30875d3b`) had silently won the re-merge for the parcel
paths (merge-base still carried the fix; tip unchanged → deletion kept).
Restored those paths from `d61e594d93` as merge hygiene so the tip under
review is what lands; re-activated the ticket (`paused/` → `active/`).
Dropped a hitchhiking `bl1110HandoffdHeartbeatSteps` require from the tip's
`index.js` (BL-1110 remains reverted on this worktree; not this parcel).

## Bounce context (Article 4.4 / BL-340)

Architect bounce `backlog/evidence/BL-1102-architect-bounce-20260824.md`
(`073158ec9d`) named D1–D3 — BL-1113 stamp-off hitchhikers (feature
wording, `cursor-forge.conf` comment drift, Spec/done `&#160;`).

## Bounce clearance this pass

| Item | Check | Result |
|---|---|---|
| D1 | BL-1113 feature Then-line / acceptance | 9/9; `HTML nbsp entity` |
| D2 | `cursor-forge.conf` / `pipelineBoard.ts` vs `27273f2b0a` | MATCH |
| D3 | Spec + done YAML entity claim | `&nbsp;` only |

## Scope (own work)

`daemon_cycle_guard_lib.bb`: catch spawn failure at `sh!`, return
`{:exit 127 :spawn-failed? true …}`; cleaner split
`spawn-failure-result` / `await-bounded-process` for CC. APS steps,
property suite, unit harness.

## Architecture

- Matches approval: return distinguishable spawn failure at the shared
  chokepoint (babysitter_check shape); wait-bound 124 and real exits stay
  distinct; drain throws still propagate.
- No webview/host boundary, secrets, or SwarmForge fork issue.
- Helpers keep CC low; `sh!` is split-args → try-spawn → branch.

## Required hard gate

`node extension/out/tools/dependency-gate.js test/bl1102SpawnFailure.property.test.js`
→ PASSED.

## Invariants review (BL-633/BL-654) — 3 declared, all encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Spawn failure never throws from `sh!` | property + feature + unit | Green |
| 2 | Spawn-miss / real exit / wait-bound distinguishable | property + feature | Green |
| 3 | Successful spawn unchanged | property + feature | Green |

## Property-testing support (undeclared)

Declared trio covered by `bl1102SpawnFailure.property.test.js` (3/3). No
additional undeclared property authored.

## Correctness read-through

- Unit ALL PASS; acceptance 6/6; properties 3/3.
- Stamp-off still green after restore; BL-1097 acceptance 4/4 (index
  still registers that domain once).

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1102-bounded-sh-throws-on-spawn-failure`, commit = this evidence
commit (BL-536 / BL-806).

By architect.
