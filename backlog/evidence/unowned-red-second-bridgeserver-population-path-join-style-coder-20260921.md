# coder — unowned red, a second eager-`bridgeServer`-requirer population invisible to BL-1685's own census, 2026-09-21

## What I was doing

Verifying BL-1685 (fourteen handlers move their `bridgeServer` require
inside the step that starts a bridge). While confirming
`bl1634RejectedManifestOffersNoPageFromItSteps.js` (a file over budget in
`stepHandlerModuleLoadBudget.test.js` at 693-734ms alone, but NOT one of
BL-1685's fourteen and NOT part of its byte-safe census) was a pre-existing,
unrelated red, I found it requires `bridgeServer` eagerly at module scope
too — just via a require SHAPE the ticket's own census command cannot see:

```js
const { startBridge } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));
```

`git grep -l 'bridge/bridgeServer'` (BL-1685's own census command) only
matches a literal, contiguous `bridge/bridgeServer` substring in the
source text. A `path.join(..., 'bridge', 'bridgeServer')` call never
produces that substring (the two path segments are separate quoted
arguments), so every file using this shape is invisible to BOTH BL-1685's
substring census (32/34 count) and its anchored eager-check regex
(`^const .*require(.*bridge/bridgeServer`).

## The population

Broad grep for ANY module-scope (`^const`) line mentioning `bridgeServer`
across every `specs/pipeline/steps/*.js` file, filtered to actual require
calls (excluding two false positives — `bl1460IdleEventsOneSnapshotSteps.js`
and `bl766MiniAppLetsTalkRetiredSteps.js` name a *test file* / *.ts source
path* as a data string, never require it) — sixteen handlers eagerly
require `bridgeServer` via this `path.join` shape, all at module scope,
none inside BL-1685's fourteen or BL-1658's fifteen:

- bl1634RejectedManifestOffersNoPageFromItSteps.js
- bl551LlmCostLedgerSteps.js
- bl565CostLedgerSyntheticPricingSteps.js
- deviceRegistrySteps.js
- bl829BubbleRemotePagePagerSteps.js
- bl866CompanionManifestPackageCatalogSteps.js
- gatesListSteps.js
- noInboundMessageIsEverLostSteps.js
- burnRateSteps.js
- operatorProactiveNotifySteps.js
- replyRelayAtLeastOnceSteps.js
- bl851SideloadApkPreauthSteps.js
- bl788BubblePairingClientLogsAdoptSteps.js
- gateAnswerSteps.js
- standingOperatorTopicSteps.js
- telegramTopicThreadsSteps.js

Spot-measured (`censusOneHandler`, single sample, this host, this shift):
bl551 275ms, deviceRegistrySteps 272ms, gatesListSteps 316ms, burnRateSteps
269ms, standingOperatorTopicSteps 355ms — all currently under the 400ms
budget on this reading, same borderline shape as bl1412's own six readings
today (five of six over budget) and bl1634's own 259-734ms spread. None of
the sixteen is red in THIS run of `stepHandlerModuleLoadBudget.test.js`
(green, confirmed above), but every one pays the full ~700-800ms bridge
graph whenever it becomes the alphabetically-first eager requirer under
load — exactly BL-1685's own mechanism, over a population its own census
command structurally cannot see.

## Search for an existing owner

Grepped `backlog/standing-reds.tsv` for `bridgeServer`, `1634`, `551`,
`565` — the only row is BL-1685's own (the first, literal-string
population). Grepped `backlog/active`, `backlog/paused` for `EXT_DIR`,
`path.join.*bridgeServer` — no ticket owns this shape. No allowlist entry
in `stepHandlerModuleLoadBudget.test.js` for any of the sixteen.

## Disposition

Filing as an `unowned-red`-style `note` (priority 00) to the specifier and
coordinator — this is a newly-discovered, currently-green-but-structurally-
identical risk class, not a currently-failing gate, so it does not block
my own parcel. Out of scope for BL-1685 itself: its own "Scope" section
names exactly fourteen handlers by the literal-substring census; widening
it to this sixteen-handler `path.join`-shaped population inside the same
parcel would be exactly the kind of scope creep the constitution's
Design-And-Testability / no-premature-abstraction rules warn against, and
BL-1685's own required_wiring/acceptance feature is pinned to the
fourteen. Recommending the specifier mint a follow-up ticket (mirroring
BL-1685's own genesis from BL-1681's bl1412 sighting) once BL-1685 lands,
with its own census command widened to catch both require shapes so a
third shape cannot recur invisibly.

Continuing BL-1685's own work (fourteen handlers, literal-string shape
only) unaffected by this finding.

By coder.
