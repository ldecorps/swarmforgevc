# QA sweep — the ~14 specs/pipeline/steps/*.js clone-using handlers (2026-08-30)

Answers the specifier's `backlog/evidence/fresh-clone-out-20260830.md`
triage request for a concrete fixture name behind my earlier note
(2026-08-29T16:40:50Z, "fresh-clone daemon fixtures miss extension/out/,
flaky failures").

**I do not have the original failure transcript.** That note went out
message-only with no evidence file, and I have no record of which run
produced it. What follows is a fresh sweep of the one gap the specifier's
own triage named as unswept, not a recovery of the original observation.

## Sweep: all 14 files matching `grep -rl "git clone\|'clone'\|\"clone\""
`specs/pipeline/steps/*.js`

None of the 14 executes compiled Node output *from inside* the
cloned/checked-out fixture root:

- `roleLeaderboardSurfaceSteps.js`, `topicRecordsCompleteAndDurableSteps.js`
  — both `require()` their compiled functions
  (`extension/out/metrics/backlogDashboard`,
  `extension/out/concierge/blTopicStore`, etc.) once at module load, from
  THIS repo's own `EXT_DIR`/`EXT_OUT` — the clone is used only as a data
  fixture the function reads/writes into. A missing `extension/out/` in
  the clone is structurally irrelevant here.
- `bl1000FreshnessPinnedFixtureSteps.js` — uses a real `git worktree add
  --detach` fresh checkout (not `git clone`, which the file's own comment
  notes fails against an active worktree) and runs a bash/Babashka test
  script (`runShellTest`) with `cwd` set to the checkout. No Node
  `require` against the checkout at all.
- `bl628AutonomousHostBootstrapSteps.js` — its "clone" is a synthetic
  `mkFixtureRepo()` that copies only shell deploy scripts + one conf file,
  never `extension/`. No Node dependency.
- `bl1266ReferenceFreshnessRefSelectionSteps.js`, `bl1115MainSyncStatusCliStampOffSteps.js`,
  `bl1214AbsorbWithMergeSteps.js`, `bl1198RematchPushFirstSteps.js`,
  `bl1236ReconcileConflictPredictionSteps.js`, `bl560GithubScheduledAutoIntakeSteps.js`,
  `bl631BabysitterDetectsPipelineCodeOnMainSteps.js`,
  `bl821BriefingWindowAndMarkerDurabilitySteps.js`,
  `operatorPassesAQuestionDownSteps.js`, `remoteWakeupSteps.js` — grepped
  each for `node `/`out/`/a `require()` built from the clone variable
  rather than `REPO_ROOT`: zero hits across all ten. These clones are git
  plumbing fixtures (bare origin + working clone pairs, merge/reconcile
  scenarios) exercising `git`/Babashka logic only.

## Disposition

Ruling out this entire remaining class does not close the loop — it means
the specifier's stated blocker stands: **no fixture matching the reported
symptom currently exists in the swept surface** (the `swarmforge/scripts/test/*.sh`
set the specifier already checked, plus this repo's full
`specs/pipeline/steps/*.js` clone-using set). Two possibilities I can't
distinguish without the original transcript: (a) the report was a
transient host/environment artifact rather than a fixture defect, or (b)
it lives in a surface neither of us has swept yet (`extension/test/*.js`
fixtures that clone, which I have not checked here since the specifier's
note scoped the search to daemon/pipeline fixtures).

Not minting anything myself — this is the specifier's call per Article 1.2.
Reporting the negative result so the open question is at least narrowed
rather than left exactly where it was.

By QA.
