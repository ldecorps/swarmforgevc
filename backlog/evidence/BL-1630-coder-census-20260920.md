# BL-1630 coder evidence: before/after require census, 2026-09-20

Same re-runnable script as the specifier's own original census
(`backlog/evidence/BL-1620-specifier-adjudication-of-coder-neither-remedy-applies-20260917.md`):
one node process, `require()` each `specs/pipeline/steps/*Steps.js` in name
order, `process.hrtime` around each; then `require('specs/pipeline/steps/index.js')`
alone, timed wall-clock. "Received commit" is `6603b47e6c` (the coordinator's
promotion commit this ticket's git_handoff named); "parcel commit" is this
ticket's own tip.

## Absolute numbers differ from the ticket's own 2026-09-17 figures - read this first

The ticket's description cites 12.6s of require time / 19.5s index.js wall
on 2026-09-17. Re-running the SAME script today, against BOTH the received
commit and the parcel commit, measures far smaller absolute numbers on
both sides (roughly 0.9-1.5s, not 12-19s) - the fix's relative effect is
still real and measured below, but the magnitude is not directly
comparable to 09-17's figures for two reasons, neither of which this
ticket owns fixing:

1. `sweepStaleFixtures()`'s cost is a `fs.readdirSync(os.tmpdir())` scan -
   its wall-clock cost scales with how many entries `/tmp` actually holds
   at measurement time. BL-1636 (landed since 09-17) found and reaped
   695,941 leaked entries from `/tmp`; today's population is far smaller,
   so the SAME unfixed sweep call costs ~46-52ms today, not ~1.1-1.2s.
2. This session required `jsdom` and its dependency tree repeatedly while
   investigating and fixing bl1153/bl1412 (both eager jsdom requirers) -
   the OS's file-page cache for jsdom's source tree is now warm, and a
   `require()`'s cost includes real disk I/O for a large, cold dependency
   tree. A fresh host/session would very likely reproduce numbers closer
   to 09-17's.

Both effects lower BOTH the before and after readings by roughly the same
amount, so the readings are still a fair PAIRED comparison on this host
right now - what they cannot do is reproduce 09-17's absolute magnitude.
The guard (`extension/test/stepHandlerModuleLoadBudget.test.js`) re-checks
this on every future run, on whatever host/tmp-population it finds.

## Before (received commit 6603b47e6c, extracted via `git archive` into an
isolated `/tmp` copy - never the live worktree, BL-1390)

```
files 1208 total_ms 929
    52 ms bl1299ReverseHopMasterResidentSteps.js
    51 ms bl1565CoordinatorNeverReceivesGitHandoffSteps.js
    48 ms bl1306HandoffAuditRerouteSteps.js
    47 ms bl1536BounceIsNeverStampedMergeOnlySteps.js
    47 ms bl1375ApprovedSiblingsCanLandSteps.js
    47 ms bl1343ReplayDropsTheTicketsOwnPathSteps.js
    47 ms bl1352EscalationTransportFaultSteps.js
    47 ms bl1335ExhaustionOpensFailoverRecordSteps.js
    46 ms bl1332SharedPathLineLeakSteps.js
    46 ms bl1320SeatOperatorStepSteps.js
    46 ms bl1323MainSyncDeadlockOverlapHintsStampSteps.js
    46 ms bl1339LandApprovalSharedRootSteps.js
    46 ms bl1327DescentLadderProposalSteps.js
     4 ms bl1000FreshnessPinnedFixtureSteps.js
```

`require('specs/pipeline/steps/index.js')` alone: 1497-1553ms wall (3 runs).

## After (parcel commit, this tree)

```
files 1210 total_ms 918
   304 ms bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js
   144 ms bl1050CursorRunFailureLogSteps.js
    54 ms aDroppedMessageMustNotParkTheOffsetSteps.js
    17 ms bl1322BridgeLazyCursorApiKeySteps.js
    11 ms bl1146HostQueueEnqueueNextHoldOnHostQuestionSteps.js
    10 ms bl1247PropertyGeneratorDomainAgreementSteps.js
     9 ms bl654InvariantPropertyTestSteps.js
     8 ms bl1248MasterMainReconcileKillSwitchSteps.js
     8 ms aChurnRewriteDoesNotMintACommitSteps.js
     5 ms alwaysOnOperatorPresenceSteps.js
```

`require('specs/pipeline/steps/index.js')` alone: 882-927ms wall (3 runs) -
about 40% faster than before, on this host, in this session, and every
one of the fourteen handlers this parcel fixed has dropped out of the top
ten entirely (each now costs low single-digit ms - see
`extension/test/stepHandlerModuleLoadBudget.test.js`'s own real-tree
assertion for the current per-handler numbers).

`bl1050CursorRunFailureLogSteps.js` (144-320ms depending on host load) is
the guard's SECOND allowlist entry - unlike bl592, it is not a cascade or
an anti-pattern: its own header states "Invariant (BL-968): module load is
requires and pure constants only", and its cost is a genuinely heavy,
non-optional require (`extension/out/bridge/cursorBridgeAgentSession.js`'s
own dependency chain), close enough to the 200ms budget that fork
contention in the full unit-lane run pushes it over. Allowlisted rather
than left to flake the guard red under load; no follow-up ticket needed
for it specifically (see the guard's own comment for the full reasoning).

## The fourteen handlers this parcel fixed (twelve named by the ticket, plus two found by this parcel's own guard)

The ticket named twelve. Building the guard (this parcel's own required
deliverable) found two MORE handlers with the exact same
`sweepStaleFixtures()`-at-load defect, invisible to the ticket's original
top-12-by-ms ranking because at measurement time they were riding
free behind whichever of the twelve happened to sort first in a
sequential census (`fs.readdirSync` itself isn't shared/cached across
handlers, so both eventually surface once the census checks EVERY handler
for the behavior, not just the heaviest twelve by absolute ms):

```
bl1299ReverseHopMasterResidentSteps.js       (named by the ticket)
bl1327DescentLadderProposalSteps.js          (named by the ticket)
bl1320SeatOperatorStepSteps.js               (named by the ticket)
bl1306HandoffAuditRerouteSteps.js            (named by the ticket)
bl1323MainSyncDeadlockOverlapHintsStampSteps.js (named by the ticket)
bl1332SharedPathLineLeakSteps.js             (named by the ticket)
bl1153StickyWebFontSizeChoiceSteps.js        (named by the ticket)
bl1335ExhaustionOpensFailoverRecordSteps.js  (named by the ticket)
bl1339LandApprovalSharedRootSteps.js         (named by the ticket)
bl1375ApprovedSiblingsCanLandSteps.js        (named by the ticket)
bl1352EscalationTransportFaultSteps.js       (named by the ticket)
bl1343ReplayDropsTheTicketsOwnPathSteps.js   (named by the ticket)
bl1536BounceIsNeverStampedMergeOnlySteps.js  (found by this parcel's guard)
bl1565CoordinatorNeverReceivesGitHandoffSteps.js (found by this parcel's guard)
```

Each of these fourteen now: (1) calls `sweepStaleFixtures()` from inside
its own `registerSteps(registry)`, never at module load, and (2) - for
the eleven that also imported `node:test` for an `afterEach`-based cleanup
hook - requires `node:test` and registers that hook from inside
`registerSteps(registry)` too, never at module load. `bl1153` additionally
moved its eager `jsdom` require into the three functions that actually
build a DOM (`bl1046`/`bl1160`'s own established lazy pattern). `bl1412SpecTreeTextFilterSteps.js`
(not in either list above - a thirteenth/fifteenth handler, depending on
how you count) got the identical jsdom+node:test fix for the same reason:
fixing bl1153 unmasked it as the new alphabetically-first eager jsdom
requirer in a sequential census.

## Two findings flagged to the specifier, NOT fixed in this parcel (out of scope)

See the 2026-09-20 unowned-defect note and `backlog/evidence/BL-1630-coder-out-of-scope-findings-20260920.md`:
1. Seven MORE handlers eagerly require jsdom at module load
   (`bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js` is the guard's one
   documented allowlist entry today; `bl609ResidentSpyFontSizeControlSteps.js`,
   `bl674EpicDrilldownUiSteps.js`, `bl686EpicDrilldownSlugMatchSteps.js`,
   `bl687EpicReorderIncludesActiveChildrenSteps.js`,
   `bl775BubbleLiveScreenShellSteps.js` and
   `bl929LiveScreenPackLayoutSteps.js` will surface ONE AT A TIME, in that
   alphabetical order, as each prior one gets fixed - a real follow-up
   ticket must fix all seven in one sweep, not bounce this guard seven
   times).
2. 73 handlers (found via a precise `node:module`-loader interception, not
   the exit-listener-count proxy an earlier draft of this guard used and
   which false-positived on unrelated legitimate `process.once('exit', ...)`
   cleanup hooks) require `node:test` at module load for an `afterEach`
   cleanup idiom - a much older and more widespread pattern than this
   ticket's own description anticipated ("three"). Not ms-budget-relevant
   today (node:test's one-time init cost is amortized to near-zero for 72
   of the 73), so the guard does not fail on it, but it is the direct
   cause of the "11 exit listeners added" / "TAP version 13 ... 1..0"
   noise on every acceptance run and property-lane run this whole
   session's transcript shows repeatedly.

By coder.
