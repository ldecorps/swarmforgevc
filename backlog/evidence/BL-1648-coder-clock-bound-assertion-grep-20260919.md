# BL-1648 - grep for other clock-bound assertions, 2026-09-19

Per the ticket's own direction: "Grep the other handlers for the same
shape before closing... list the hits in evidence (fix only BL-1428's
here; others are a note to the specifier)."

## `grep -ln 'Date.now\|LocalDate/now\|new Date()' specs/pipeline/steps/*.js`

~135 files match. Spot-checked a representative sample
(bl1021SubprocessOutlivesWaitBoundSteps.js, bl1070PaneLivenessDepthSteps.js,
bl1204RedeployTargetsReachableAndListedSteps.js,
bl897BriefingGathersLifecyclesOnceSteps.js,
suiteDurationReadoutSteps.js): every one uses `Date.now()`/`new Date()`
for an ELAPSED-TIME or TIMEOUT computation (a wait bound, a liveness
window, a pinned `nowMs` fixture clock), never a hardcoded calendar age
compared against a fixed number. This is the expected, safe shape - the
grep alone over-reports because most `Date.now()` uses are legitimate.

## `assert.equal(..., <number>)` on an age/days-shaped field

`grep -nE "assert\.equal\(.*(age|Age|_days|Days)\w*,\s*[0-9]+\)"
specs/pipeline/steps/*.js` - 4 matches, none a calendar-age assertion:
`bl1166OperatorDocsSteps.js:144` (`bl1166LatestPageStatus, 200` - an
HTTP status), `bl1542TicketStripCollapseSteps.js:255` /
`bl609ResidentSpyFontSizeControlSteps.js:228` (`storageWrites, 0` -
matches on "orage" inside "storageWrites", not "age" as a word),
`bl1155PipelineBoardGridHeaderOneLineSteps.js:94` (`stageCellWidth, 2` -
matches on "age" inside "stageCellWidth"), `bl593...` (`no_coverage, 0`
- matches "age" inside "coverage"),
`bl764FrontDeskEatsHostBridgeUpdatesSteps.js:248` (`messageId, 555` -
false positive, no "age"/"days" substring at all on inspection; the
regex's `\w*` after the alternation likely matched trailing chars of an
adjacent token). None are BL-1428's shape (a fixture row's `first_seen`
date compared against a hardcoded `age_days`/`oldest_age_days` derived
from the real clock).

## Conclusion

BL-1428 appears to have been the only instance of this pattern
(BL-1006's shape: an assertion true only relative to the day it was
authored). No other handler needs the same fix; nothing further noted
to the specifier beyond this evidence file itself.

By coder.
