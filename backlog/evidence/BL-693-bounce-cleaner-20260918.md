# BL-693 — send-back to coder, 2026-09-18 (cleaner)

## What happened

`specs/pipeline/steps/bl693DocsDuplicateParagraphGuardSteps.js`'s
`mkFixtureRoot()` (line 39-41) calls `fs.mkdtempSync` and is invoked from
four separate step handlers (scenarios 02, 03, 04, 05: `ctx.scannedTree =
mkFixtureRoot()`), with no cleanup anywhere in the file - no `finally`, no
tracked-set/`onAbnormalExit` registration, no `afterEach`. Every scenario
run leaks one permanent directory under the host's `os.tmpdir()`.

This is not hypothetical: the same class already surfaced and was fixed
twice this session in sibling tickets (`BL-1626PromotionFixturesCarryThe
ClosureSteps.js`, `bl1632Bl1071ProbeCountsOnlyItsOwnFixturesHangsSteps.js`,
and this exact handler's own sibling `bl1624StandingShellTestNeverDiffs
AgainstMainSteps.js`), all via the same `fixtureReaper.js`
`onAbnormalExit`-tracked-dir pattern.

## Confirmed today

```
$ rm -rf /tmp/bl693-acc-*
$ bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-693-*.feature
... 13/13 scenarios pass ...
$ ls -d /tmp/bl693-acc-*
/tmp/bl693-acc-2oB31S
/tmp/bl693-acc-2sJluW
/tmp/bl693-acc-B4O2QK
/tmp/bl693-acc-E9bN73
/tmp/bl693-acc-KzLDcU
/tmp/bl693-acc-W3HMYM
/tmp/bl693-acc-eGTSe3
/tmp/bl693-acc-iTmDLh
/tmp/bl693-acc-rSkowR
/tmp/bl693-acc-shhn7t
/tmp/bl693-acc-y0v1WP
```
11 directories, never removed, from one acceptance run. This feature
lands and will run repeatedly (QA's own e2e, and any future landed-
feature lane) - every run adds more permanent leaked roots under
`os.tmpdir()`, the exact precondition the BL-1385/BL-1390/BL-1623/BL-1632
incident family needed.

## Why this bounces rather than gets fixed here

`specs/pipeline/steps/*.js` is Gherkin/acceptance-handler maintenance,
explicitly out of the cleaner's domain (cleaner.prompt "Does Not Own: Do
not create, run, or maintain acceptance tests, Gherkin, IR..."); the
ticket's own constraints name the step handler as landing with the
feature, the coder's file to change.

## The fix (direction, not mandate)

Apply the SAME `fixtureReaper.js` `onAbnormalExit`-tracked pattern this
handler's own sibling `bl1624StandingShellTestNeverDiffsAgainstMainSteps.js`
already uses (and `bl1626`/`bl1632` before it): track each
`mkFixtureRoot()` result the moment it exists, remove it inline once the
scenario's own assertions have read it (in a `finally` so a failed
assertion still cleans up), and register the tracked set against
`onAbnormalExit` so an uncaught throw between creation and the terminal
step still reaps it.

My own review of BL-693's authored diff otherwise found nothing else to
raise: the guard logic (`docsDuplicateParagraphGuard.js`), the standing
Vitest test (20/20 green including the real-tree scan), the property test
(2/2 green), the `docs/index.md` two-line triaged fix, and the acceptance
scenarios' own assertions are all clean, scoped, and correct as written.

Sending as a `git_handoff` to coder, priority 00, carrying this merge
commit, rather than a bare note, since real test-handler work needs to
change.

By cleaner.
