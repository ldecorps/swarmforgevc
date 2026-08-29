# Three of my own step-handler files hijacked other features' scenarios

Coder, 2026-08-29. Self-reported defect, found while merging QA-approved
BL-1268 into this worktree and re-running the acceptance suites either side.

## What happened

`specs/pipeline/stepRegistry.js` resolves an UNSCOPED registration by
first-match across every handler file (BL-425's design: `defineScoped` exists
precisely so a new ticket can pin generic step text to its own feature). I
registered three handler files this session with `registry.define` and generic
step text:

| my file | the step text | whose scenario it answered |
|---|---|---|
| `bl1267AdjudicationDischargeSteps.js` | `the deprecator freshness check runs for that ticket`, `the decision is "…"` | **BL-1268's** — 5 of its 7 scenarios failed |
| `bl1220UnitLaneRunnerBindingSteps.js` | `the guard passes` | **BL-378's** — "Every file within budget passes" failed |
| `bl603TrendsPublishedOnMiniAppSteps.js` | `the request is served` | BL-866's (shared text; BL-866 is green either way) |

The BL-1268 case is the sharp one: its acceptance was 7/7 when I delivered it,
and my LATER BL-1267 parcel silently turned it 2/7 by answering its scenarios
with BL-1267's fixture. The failure read
`expected allow, got hold (ticket claims itself superseded-by in field
'closed_as')` — BL-1267's fixture ticket, in BL-1268's scenario.

Nothing about the shipped behaviour of any of the three tickets was wrong. The
defect is entirely in how their step handlers were registered.

## Why I did not catch it at the time

I ran each ticket's OWN acceptance after building it, and each passed — the
hijacking file always wins its own feature too. What I did not do is re-run the
acceptance of the features whose step text I had just started shadowing. A
green run of the feature you are working on is not evidence that the registry
is still resolving correctly for everyone else.

## The fix

All three files now register through
`registry.defineScoped(pattern, handler, FEATURE_NAME)`, the mechanism BL-425
built for exactly this. No handler logic changed; no feature file changed.

## Verified after

    BL-1267  10/10
    BL-1268   7/7   (was 2/7)
    BL-1220   4/4
    BL-603   14/14
    BL-378    4/4   (was 3/4)
    BL-866   10/10

## The wider sweep

A mechanical scan for duplicate UNSCOPED step patterns across
`specs/pipeline/steps/` finds **12** pairs. Three were mine and are fixed here.
The other nine predate this session and are left alone — each is a live
first-match resolution that may or may not be answering the right feature:

    /^the swarm is running$/                          alwaysOnOperatorPresence | swarmSocketNotInTmp
    /^the supervisor checks whether it may spawn …$/   bl403 | bl411
    /^no board message has been posted yet$/           bl462 | bl468
    /^the ticket is still pending review$/             bl484 | bl589
    /^an approval ask was posted in a ticket's …$/     bl490 | bl589
    /^the shipped repository documentation$/           bl617 | bl623
    /^the ambulance is released$/                      bl655 | bl852
    /^the burndown is rendered$/                       burndownEta | pwaLabelCatalog
    /^a swarm running headless, with no editor …$/     headlessResourceSampling | retireLegacyTelegramNarrator | stuckEscalationEmail
    /^the swarm's health is reported$/                 mergedCodeReachesDaemons | restrictedFrontDeskOperator

Not my parcels to change, and a scan is not proof any of them is wrong — but
the same failure mode is available to all nine, and it is silent. Worth a
ticket: either a mint-time guard that refuses a new unscoped registration
duplicating an existing pattern, or a sweep that scopes them all. Raised for the
specifier rather than widened into this fix.
