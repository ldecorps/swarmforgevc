# BL-831 — send-back to coder, 2026-09-18 (cleaner)

## What happened

`specs/pipeline/steps/bl831BubblePipelineBoardPageSteps.js`'s fixture
helper (line 28: `ctx.bl831 = { root: fs.mkdtempSync(path.join(os.tmpdir(),
'bl831-')) }`, invoked lazily from multiple scoped steps across the
feature's scenarios) has no cleanup anywhere in the file - no `finally`,
no tracked-set/`onAbnormalExit` registration, no `afterEach`. Every
scenario run leaks one permanent directory under the host's
`os.tmpdir()`.

Same class already fixed FOUR times this session in sibling handlers
(`bl1624StandingShellTestNeverDiffsAgainstMainSteps.js`,
`bl1626PromotionFixturesCarryTheClosureSteps.js`,
`bl1632Bl1071ProbeCountsOnlyItsOwnFixturesHangsSteps.js`, and this same
pass's own `bl693DocsDuplicateParagraphGuardSteps.js`), all via the same
`fixtureReaper.js` `onAbnormalExit`-tracked pattern - the coder's own
BL-677 evidence this same session explicitly cited "BL-693's own bounce
this same pass" and applied the pattern proactively there, but it did not
carry to this handler.

## Confirmed today

```
$ rm -rf /tmp/bl831-*
$ bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-831-*.feature
... 8/8 scenarios pass ...
$ ls -d /tmp/bl831-*
/tmp/bl831-6ooNLN
/tmp/bl831-7KOG15
/tmp/bl831-ME5Bb7
/tmp/bl831-YGmkoF
/tmp/bl831-dly5Qp
/tmp/bl831-gGaG46
/tmp/bl831-pKIKcn
/tmp/bl831-tQZddv
```
8 directories, never removed, from one acceptance run. This feature lands
and will run repeatedly (QA's own e2e, and any future landed-feature
lane) - every run adds more permanent leaked roots under `os.tmpdir()`.

## Why this bounces rather than gets fixed here

`specs/pipeline/steps/*.js` is Gherkin/acceptance-handler maintenance,
explicitly out of the cleaner's domain (cleaner.prompt "Does Not Own: Do
not create, run, or maintain acceptance tests, Gherkin, IR..."); the
ticket's own constraints name the step handler as landing with the
feature, the coder's file to change.

## The fix (direction, not mandate)

Apply the same `fixtureReaper.js` `onAbnormalExit`-tracked pattern this
session's other handlers now use: track `ctx.bl831.root` (and the
`startBridge` handle, if one is separately held) the moment they exist,
clean up inline once each scenario's own assertions have read them (in a
`finally` so a failed assertion still cleans up), and register the
tracked set against `onAbnormalExit` so an uncaught throw mid-scenario
still reaps it. Since the helper is shared across several scoped Given
steps via lazy `if (!ctx.bl831)` construction, the cleanup site is likely
best placed in each scenario's own terminal Then step, mirroring
`bl693DocsDuplicateParagraphGuardSteps.js`'s `cleanupFixtureRoot(ctx)`
helper shape (tolerant of "nothing to clean up" where a scenario shares a
Background step with one that never builds a fixture).

My own review of BL-831's authored diff otherwise found nothing else to
raise: the blurb-source logic (`pipelineGridLive.ts`'s `blurb()`), the
detail-sheet content, the manifest registration, the one-board-read-model
invariant, the unit tests (97/97 green), and the property test (4/4
green, invariant 1 checked) are all clean, scoped, and correct as
written.

Sending as a `git_handoff` to coder, priority 00, carrying this merge
commit, rather than a bare note, since real test-handler work needs to
change.

By cleaner.
