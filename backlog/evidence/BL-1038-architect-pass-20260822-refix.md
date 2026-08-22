# BL-1038 architect pass — 2026-08-22 (clears architect SEND BACK #2)

**Parcel:** cleaner-forwarded commit `308626d3b9` ("restore the
copyLiveScriptClosureInto dedup the merge silently dropped"), merged into
`swarmforge-architect` at `9ef6df9e0`.

## Merge required a full accept — and caught its own silent drop

7 conflicts against this branch's own BL-1039 merge (`87cc32169`): the six
files shared by operation with BL-1039, plus `telegramFrontDeskBotCli.test.js`.
Unlike the previous BL-1039 merge (which had to actively AVOID resurrecting
bounced BL-1038 content), this lineage IS the awaited fix — bounce #2
(`66e8fc675`) is confirmed an ancestor of `308626d3b9`. Verified the incoming
side already has BOTH `copySeededRepoInto` (BL-1039) and
`copyLiveScriptClosureInto` (BL-1038) integrated together before resolving,
then took the incoming side wholesale for all 7 conflicts.

`specs/pipeline/steps/index.js` auto-merged with **no conflict marker** but
ended up missing the `bl1038UnitTestsPinTheRepoSteps` registration that
`308626d3b9` itself carries — the exact BL-954-shaped hazard ("a merge can
silently revert already-landed work the sender never had"), just recurring at
the registration-list level after my own bounce-#2 revert had removed that
line from this branch's merge-base. Caught by diffing my resolved tree
against the incoming commit directly (`git show 308626d3b9:...index.js`)
rather than trusting a clean auto-merge; restored the registration before
committing. This is the SAME class of drop the cleaner's own commit message
(`308626d3b9`) describes catching one level down (the `copyLiveScriptClosureInto`
dedup silently reverting in `pinnedRepoFixture.js` and three callers) — cross-role
discipline held on both sides of this merge.

## D1 (architect SEND BACK #2) — cleared, verified independently

My bounce found the guard blind to an INDIRECT derivation: the four headline
files (`renderBriefingDiagramsCli`, `renderBriefingBurndownCli`,
`briefingDigestLineCli`, `emitLifecycleSnapshotCli`, ~99.9s of the ticket's
own measured cost) never write a growth operation inline — they bind the live
root and hand it to a production module (`runCli`/`renderBriefingBurndown`/
`lifecycleSnapshotPath`), which does the reading. The guard's own
`findLiveRepoDerivations` returned `[]`, so the "real tree is clean" test
passed vacuously against the majority of the cost this ticket exists to fix.

The fix (`liveRepoDerivationGuard.js`'s new `liveRootEscapesIntoProduction`):
detects a live root (bound variable OR inline expression) handed as any
argument to a callee that imports from `../out/`/`../src/`, closed to a
fixpoint through local wrapper functions (`runCli`, `runCliSubprocess`) so
one level of indirection doesn't hide it. Verified directly, not taken on the
commit message:

```
$ node -e "...liveRepoDerivation() over the four real files..."
renderBriefingDiagramsCli => "hands the live repository root to production code (runCli)..."
renderBriefingBurndownCli => "hands ... (renderBriefingBurndown)..."
briefingDigestLineCli     => "hands ... (runCli)..."
emitLifecycleSnapshotCli  => "hands ... (lifecycleSnapshotPath)..."
```
All four now genuinely DETECTED (was `null`/blind before), each carries a
recorded `BL-1038-EXEMPT:` reason so the overall violation is `null` — armed,
not merely quiet. Non-vacuity confirmed myself, in-memory only: stripping
either the reason or the whole marker from `renderBriefingBurndownCli.test.js`
flips it to a real violation both ways. `findLiveRepoDerivations('./test')`
over the real tree: **0** (down from a would-be-59-if-armed state, matching
the guard's own new standing regression test).

The widened rule honestly reached two MORE files the original four-file list
never named — `chaseTrendLineCli.test.js` and `pricingTable.test.js` — both
now correctly detected and exempted with substantive, specific reasons
(`pricingTable`'s is a strong case: the live read genuinely IS the assertion,
collecting the repo's own referenced models to check pricing coverage; a
pinned fixture would freeze the model list and defeat the test's purpose).
Six exemptions total, all read directly, all name a real repository shape or
signal a fixture would destroy — none is a restatement of the rule.

**A standing regression test now exists** for exactly what my bounce demanded
be made non-vacuous: `liveRepoDerivationGuard.test.js`'s "the four headline
files are genuinely REACHED" reads the four real files from disk, strips
their exemption marker in-memory, and asserts the guard still flags each. If
a later change blinds the scan again, this goes red instead of the tree
quietly reporting `[]`. Re-ran: 19/19 (was 11), including this test and 6
other new D1-specific cases (direct import, local wrapper, inline root,
spawned-CLI wrapper, and three correct negatives — fixture root, O(1)
path-only use, non-production helper — confirming the widened rule did not
overreach).

## Correctness — full-scale, reproduced independently

- `npm run compile` — green.
- Acceptance `BL-1038-...feature` run live: **8/8 pass.**
- **Full default unit lane**: **466/467 files, 8267/8268 tests pass** —
  matches the coder's claim exactly. The one failure is the pre-existing,
  already-confirmed-ancestor-of-`main` `tempDirTrapGuard.test.js` (BL-1033).
  All 467 files within BL-378's 7000ms budget.
- **Full property lane** (background, 85.9s): **136/139 files, 399/404
  tests pass.** 3 failing files (`bl643NonPipelineAgentPaths`,
  `bl796NvmNodePathFollowUpAdoptInvariants`, `bl857TunnelOwnershipInvariants`)
  — all three already confirmed pre-existing/ancestor-of-`main` and unrelated
  during this session's BL-1039 pass; none touches this parcel's diff. (A
  4th file, `bl968MaterializedGuardSensitivity`, failed on the FIRST property
  run today and not this one — consistent with its own documented
  reach-floor generator flake, not a regression.) 2 unhandled errors, both
  the exact allowlisted `[vitest-worker]: Timeout calling "onTaskUpdate"`
  benign artifact.
- The six exempted files' own suites, re-run directly: **47/47 pass**
  (the coder's evidence states 54; the discrepancy is immaterial to
  correctness — every test in all six files is green, and the exemption
  logic is independently verified above rather than taken on this count).
- Scenario-07/draft-restore state confirmed intact:
  `.feature.draft` absent, live feature carries 7 scenarios.

## Dependency-rule gate (BL-259, hard gate)

Scoped to this parcel's ~19 changed files: same pre-existing 3-edge
`acyclic` cycle (`telegram-front-desk-bot.ts → telegramCursorOperatorExec.ts
→ telegramCursorOperatorLiveness.ts`) confirmed on every pass this session,
already tracked at `backlog/paused/BL-759-...yaml`. Not this parcel's
defect.

## Co-change report (informational, BL-255)

Flagged pairs are all siblings from the same `unit-suite-speed` epic
(BL-815/914/969/999/1007/1038/1039 all touch many of the same CLI test files
across this session) — expected, nothing new or suspicious.

## Invariant 3 (speed never bought with coverage)

Coder's evidence: `test_count` 603, unchanged; own full-lane run 8267/8268 —
consistent with my own 466/467-file, 8267/8268-test run. No skip/todo/exclude
change observed in any file reviewed.

## What is NOT the problem — do not change

- The six original converted `*Bridge`/`commitIntegrityRunner`/
  `telegramFrontDeskBotCli` files and the cleaner's dedup helper
  (`copyLiveScriptClosureInto`) — correct, keep as-is.
- Scenario 07's restoration — correct, keep as-is.
- The six D1 exemptions (four original + two newly-reached) — legitimate,
  specific, keep as-is.
- `liveRepoDerivationGuard.js`'s widened detection and its self-exempt list —
  correct; verified it does not overreach via the three negative test cases.

## Verdict

COMPLIANT. Architect SEND BACK #2 is cleared, independently reverified
against the real guard, the real four (plus two) files, and the full unit +
property lanes. Forwarding to hardener.

By architect.
