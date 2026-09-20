# BL-1630 out-of-scope findings, 2026-09-20

Found while building this ticket's own required deliverable (the
require-census guard, `extension/test/stepHandlerModuleLoadBudget.test.js`
+ `extension/test/helpers/stepHandlerRequireCensus.js`). Neither is this
parcel's own defect to fix - both are pre-existing, span far more files
than the ticket's twelve, and (for #1) cascade in a way that makes a
partial fix pointless. Flagging per the standing-red-adjacent rule ("a
red you did not cause still needs an owner") even though neither is a
literal test failure - the guard this ticket lands would otherwise be the
only place either is visible, and it deliberately does not fail on them
(see the reasoning in both files' own comments).

## Finding 1: seven more handlers eagerly require jsdom at module load, in a require-cache CASCADE

`grep -rln "^const.*JSDOM.*=.*require\|^const { JSDOM }" specs/pipeline/steps/*.js`
finds, beyond bl1153 and bl1412 (fixed by this parcel):

```
bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js
bl609ResidentSpyFontSizeControlSteps.js
bl674EpicDrilldownUiSteps.js
bl686EpicDrilldownSlugMatchSteps.js
bl687EpicReorderIncludesActiveChildrenSteps.js
bl775BubbleLiveScreenShellSteps.js
bl929LiveScreenPackLayoutSteps.js
```

A sequential require census pays jsdom's real load cost exactly ONCE -
whichever handler is alphabetically first among every STILL-eager
requirer at the time. Fixing bl1153 (this parcel) made bl1412 (not
previously visible - it was riding bl1153's cache entry) the new first
payer; fixing bl1412 (this parcel, since it was directly unmasked by
bl1153's own fix) made bl592 the new first payer. bl592 is measured at
~300ms and is this ticket's one documented guard allowlist entry
(`extension/test/stepHandlerModuleLoadBudget.test.js`'s `ALLOWLIST`).

Fixing bl592 alone would NOT clear the guard - it would simply make
bl609 the next first payer, then bl674, then bl686, then bl687, then
bl775, then bl929 (that is their alphabetical order). A follow-up ticket
must fix all seven (the same two-line pattern already applied to
bl1153/bl1412: move the eager `const { JSDOM } = require(...)` into each
function that actually builds a DOM) in ONE sweep, then remove the
allowlist entry, or it will bounce this guard seven times in a row as
each fix unmasks the next name.

## Finding 2: 73 handlers require node:test at module load for an afterEach cleanup idiom

`grep -qE "^const \{[^}]*\} = require\('node:test'\);"` over
`specs/pipeline/steps/*.js` matches 73 files (not the ticket's own
description's "three" - bl1021/bl1064/bl1069 - which undercounted this by
a wide margin, likely because only the alphabetically-first such
handler's incremental ms was ever large enough to show up in a top-12
ranking; the OTHER 72 pay near-zero once node:test's one-time init cost is
already in the require cache).

This is the standing-idiom cause of the `MaxListenersExceededWarning:
... 11 exit listeners added` and `TAP version 13 ... 1..0` noise on every
acceptance run and property-lane run (visible throughout this session's
own test output). It predates a newer, better pattern already in use
elsewhere (`ctx.__disposables`, the real APS runtime's own per-scenario
disposal mechanism - see `specs/pipeline/runtime.js`'s `dispose()` and
e.g. `bl1545SyncMergePassengerTestOraclesSteps.js`'s usage), which needs
no global test-runner registration at all.

This parcel's guard does not enforce "no node:test at module load" as an
absolute tree-wide check (an earlier draft tried an exit-listener-count
proxy, which ALSO false-positived on legitimate, unrelated
`process.once('exit', ...)` cleanup hooks some handlers use for their own
reasons - see `stepHandlerRequireCensus.js`'s own comment on why it now
intercepts `node:module`'s loader directly instead). Flagging all 73 as
guard failures the day this lands would be roughly a 6x scope explosion
over the twelve handlers this ticket sized as "one sitting" - a
follow-up ticket's own call, not a hard block on THIS one landing.

By coder.
