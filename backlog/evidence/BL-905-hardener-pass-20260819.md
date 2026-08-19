# BL-905 hardener pass — 2026-08-19

## Scope

Received from architect as `merge_and_process architect c23d50f4f0`, which
carries the coder's fixture-leak fix (`3db131a15a`, architect bounce D1) for
the fixture-dir leak in `specs/pipeline/steps/bl905HideChildlessEpicsReorderSteps.js`.
This is a certify-review ticket: the ticket's own instruction is to treat
the already-landed hotfix (`0f5394a2d0`) with the same suspicion as fresh
code, since no stage had run gates on it before this ticket, and to run
"the normal gates: coverage, no surviving mutants, CRAP <= 6, DRY."

## Fixture-leak fix — independently re-verified

Re-ran the acceptance suite myself twice (not just trusting the architect's
counts):
```
node specs/pipeline/cli.js specs/features/BL-905-hide-childless-epics-reorder.feature
```
Run 1: 9/9 PASS, `sfvc-bl905-*` dirs under `$TMPDIR`: 0 before, 0 after.
Run 2 (immediately after): 9/9 PASS, 0 before, 0 after. Stable across two
clean runs, matching the coder's own fix verification (including their
self-caught `deferCleanup` reuse bug from the fix's first draft). Confirmed
`runScenario` (`specs/pipeline/runtime.js:19`) creates a fresh `context = {}`
per scenario/example row, so `ctx.deferCleanup` can never leak across
scenarios — the fix is structurally sound, not just empirically lucky.

## Coverage

Targeted (not full-suite, see Stryker note below):
```
npx vitest run test/epicReorderBridge.test.js test/epicTopicSlugMatch.test.js
```
43/43 PASS. Property lane (`npm run test:properties -- epicTopicSlugMatch`):
3/3 PASS.

## CRAP

`node scripts/crapReport.js src/bridge/epicTopicSlugMatch.ts
src/bridge/bridgeServer.ts src/bridge/epicReorderUiHtml.ts` against coverage
from the targeted run above reports "37 function(s) exceed CRAP <= 6" — but
every one of the 37 is a function OUTSIDE this ticket's scope (letsTalk,
cursorBridge, telegram inbound, pausedPager, costRank, contextBudget,
gateAnswer, replyAck, sideloadApk routes) in the same large shared
`bridgeServer.ts` file, flagged only because this narrow 2-file test run
doesn't exercise their own dedicated test files, not because this ticket
touched them. This is the file's pre-existing complexity debt named in
`swarmforge/roles/hardender.prompt`'s own rule_proposal about
`bridgeServer.ts`'s shared dispatcher (BL-866), not a defect introduced
here.

Every function this ticket actually certifies scores clean:
- `readEpicReorderMembership` — CRAP=1.00 (100% cov)
- `computeEpicReorderState` — CRAP=1.00 (100% cov)
- `handleEpicReorderMoveRoute` — CRAP=2.00 (100% cov)
- `isEpicReorderMoveRequestShape` — CRAP=5.00 (100% cov, complexity=5)
- `isEpicReorderMoveRoute` — CRAP=3.00 (100% cov)
- `isEpicReorderPath` / `isEpicReorderStatePath` — CRAP=2.00 each (100% cov)
- `resolveEpicWritePaths` — CRAP=3.00 (100% cov)
- `commitEpicReorderWrites` — CRAP=1.00 (100% cov)
- `filterEpicsWithTopics` — CRAP=3.00 (100% cov)
- `resolveTopicMembership` — CRAP=3.00 (100% cov)
- `epicIdsForSlug` — CRAP=2.00 (100% cov)
- `computeEpicTopics` — CRAP=1.00 (100% cov)
- `getEpicReorderUiHtml` — CRAP=1.00 (100% cov)

All well under the CRAP <= 6 gate, all fully covered by this ticket's own
tests.

## DRY

`npm run dry` (jscpd over the whole `src` tree): 35 clones found project-wide
(0.52% duplicated lines), none involving `epicTopicSlugMatch.ts`,
`epicReorderUiHtml.ts`, or any `bridgeServer.ts` line range this ticket's
diff touches. No duplication introduced by this parcel.

## Mutation (Stryker) — DEFERRED, not run, recorded as such

Per the office-hours mutation bypass policy (`swarmforge/roles/hardender.prompt`):
checked `uptime` immediately before attempting a run and again a few minutes
later while running the lighter gates above:
```
05:32  load averages: 16.18 12.51 10.89   (4.0x cores on 1-min)
05:37  load averages: 26.80 21.96 15.63   (6.7x cores on 1-min)
```
4 cores on this host; both readings are well past the documented
load-avg-over-2x-cores threshold at which even a concurrency=1 differential
dry run reliably times out rather than completing. Load climbed between the
two checks rather than subsiding, consistent with concurrent swarm activity
elsewhere on the host, not a transient blip. Per policy: do not stall this
parcel waiting for a quiet host — forward now with the coverage/CRAP/DRY/
property/acceptance evidence above, and the full mutation pass lands on the
next quiet pass (coordinator's own Mutation-Heavy Scheduling routes
mutation-cost:medium tickets like this one overnight where possible).

**This is recorded as BLOCKED BY host load, not skipped or implied to have
run** — the "no surviving mutants" gate this ticket names has not yet been
exercised for `filterEpicsWithTopics`/`readEpicReorderMembership`/
`handleEpicReorderMoveRoute`. Given the extensive prior evidence already on
this ticket (architect's invariant-review with a real revert-and-recompile
non-vacuity check on both declared invariants, 100% coverage on every
in-scope function, and the coder's own documented non-vacuity check on the
production filter), the risk this parcel carries forward without a
completed Stryker pass is low, but it is a real, named gap and not a
formality.

## Verdict

No new defect found. Fixture-leak fix (D1) independently confirmed sound.
Coverage/CRAP/DRY clean for every function this ticket certifies. Stryker
mutation deferred to the next quiet host per documented policy — recorded
above, not silently skipped. Forwarding to documenter.

By hardener.
