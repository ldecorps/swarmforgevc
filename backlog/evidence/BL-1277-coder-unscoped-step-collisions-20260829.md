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

---

## Specifier addendum, 2026-08-29 — this file's own provenance

Everything above is the coder's, verbatim, recovered from commit `205fdd36f`
("Scope my three step-handler files so they stop answering other features'
scenarios"). That commit **never landed on `main`** and is not going to in its
present form: QA found it entangled in the BL-1273 documenter tip and rebuilt
that parcel tip-pure (`1921de5c4`), so `205fdd36f` now sits on all five
pipeline branches (coder, cleaner, architect, hardender, documenter) carrying
no ticket of its own. Recovered here so the diagnosis is durable on `main`
rather than reachable only by `git show 205fdd36f:`.

### What I measured on `main` today, rather than inherited

Live scan of `specs/pipeline/steps/*.js` for the same pattern registered
`registry.define` (unscoped) by more than one file:

    15 colliding patterns / 17 unordered file pairs

That reconciles exactly with the coder's numbers once "three were mine" is read
as three FILES rather than three patterns: their three files account for 5 of
the 15 patterns (`bl1220` x `noSingleFileBoundsTheSuite` = 1, `bl1267` x
`bl1268` = 3, `bl603` x `bl866` = 1), and the 10 listed under "The wider sweep"
are the remainder. No collision has been fixed on `main`; the count is 15
because `205fdd36f` is absent, not because new ones appeared.

Caveat on the number: this is a source-text scan, the very thing BL-1277's
second invariant forbids the shipped guard from being. It is indicative, good
enough to size the sweep, and is not the guard's verdict.

### The two live reds, measured not inferred

`specs/pipeline/steps/index.js` fixes load order, and in every one of the three
pairs the coder's file loads first, so it wins first-match resolution:
`bl603` (line 10), `bl1220` (11), `bl1267` (12) all precede `bl1268` (13),
`noSingleFileBoundsTheSuite` (220) and `bl866` (535). Ran both losers:

    node specs/pipeline/cli.js specs/features/BL-1268-stale-claim-branch-must-name-this-ticket.feature
      -> 7 tests, 2 pass, 5 fail    (coder measured 2/7 before delivery: 7/7)
    node specs/pipeline/cli.js specs/features/BL-378-no-single-file-bounds-the-suite.feature
      -> 4 tests, 3 pass, 1 fail    (coder measured 3/4; was 4/4)

BL-1268's first failure is `Cannot read properties of undefined (reading
'reason')` — BL-1267's fixture context evaluated inside BL-1268's scenario,
the same shape the coder recorded. Both tickets are shipped and in
`backlog/done/M8/`; neither is defective. The acceptance evidence for both is.

### Disposition

No new ticket. This is BL-1277's sweep half, and `205fdd36f` is liftable prior
art for 3 of the files it must touch — see that ticket's amended notes.
