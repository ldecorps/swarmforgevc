# BL-1063 — hardener pass

Received from architect as `merge_and_process architect 3980e6c723` (the
cleaner's merge of the coder's re-fix after the architect's own D1 bounce —
see `BL-1063-architect-bounce-20260823.md` and
`BL-1063-coder-bounce-response-20260823.md`). No new architect-pass evidence
file accompanied the forward; verified the re-fix independently below rather
than taking the forward on trust.

## D1 (the bounce) — re-verified fixed, not re-argued

Read `callerNodePath()`/`nodelessCallerPath()` in both
`bl796NvmNodePathFollowUpAdoptInvariants.property.test.js` and
`bl1063BoundedWaitSteps.js` directly: the "resolves" half is now a real stub
this test places (`<stubDir>:<nodelessFarm>`), asserted against a known path,
never a live `command -v node` query against a literal PATH that may or may
not resolve on the running host. `grep -c "'/usr/bin:/bin'"` is `0` in both
files the bounce named (site 3/4); the two literals remaining in
`bl796…property.test.js` are the `callerPathArb` hostile-noise shapes
(appended to the farm, not used as the caller PATH) and invariant 2's
`searchPath` (a claim about PATH-mutation, never about node's origin) — both
confirmed correct by the coder's own evidence and re-read here.

## BL-113 gherkin mutation — both Scenario Outlines, 6/6 killed

The feature carries two Outlines (scenario 04, "resolvability-not-origin",
2 rows; scenario 06, "host-independent-verdict", 2 rows) — 6 dynamic mutants.
Ran soft: **6/6 killed** on the first pass, no fixes needed. Unlike BL-1086's
Outline earlier this session, these step handlers' downstream assertions are
already keyed on the Examples value itself (`checkInvariantOne`'s per-row
dispatch, `assert.equal`s against the literal origin/host strings) rather than
by shape — the coder's bounce-response farm rework happened to make every row
independently observable.

## Fixture-leak check — investigated, false alarm

`bl1063BoundedWaitSteps.js`'s scenario 01 ("the assertion waits for the
child's marker") ends on a `Then` step that never calls the module's own
`cleanup()` — the same SHAPE as the real leak found and fixed in BL-1086
earlier this session. Investigated rather than assumed: `tmpDirs` is a single
module-scope array shared across every scenario the acceptance run executes
in one process, and scenario 02 (which runs immediately after, in the same
process) DOES call `cleanup()` at its own terminal step — sweeping scenario
01's leftover root along with its own. Confirmed empirically, not just by
reading: cleared `/tmp/bl1063-*` (finding only stale debris from other
concurrent worktrees' own runs, timestamped well before this pass started,
not created by this pass), then ran the acceptance feature and the two
property files in isolation — `ls /tmp/bl1063-* | wc -l` was `0` after each.
No leak in the CURRENT code for this feature; the BL-1086 case was a genuine
bug (two scenarios where NOTHING later in that run ever called cleanup) and
this is not.

## Verification

| check | result |
|---|---|
| BL-1063 acceptance feature | 8/8 |
| `bl796NvmNodePathFollowUpAdoptInvariants.property.test.js` | 3/3 |
| `bl1063BoundedWaitInvariants.property.test.js` | 6/6 |
| BL-113 gherkin mutation, both Outlines (soft) | 6/6 killed |
| full extension unit suite | 8568/8568, 477/477 files |
| standing whole-tree guards (`test/*Guard*.test.js`, non-property — property test files and a step file were touched) | 13 files, 125/125 |
| fixture-leak check (`/tmp/bl1063-*` before/after, isolated) | 0 leaked |

No code changes were needed — every gate this stage owns was already closed
by the coder's bounce response. No orphaned mutation/test processes at
handoff (`pgrep -fl 'node --test|stryker'` scoped to this worktree, clean).

## Handoff

Forwarded to documenter, task `BL-1063-assertion-races-a-backgrounded-daemon`.
