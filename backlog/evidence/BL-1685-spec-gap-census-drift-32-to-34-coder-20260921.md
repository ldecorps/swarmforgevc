# BL-1685 — coder spec-gap, byte-safe census drifted 32 → 34, 2026-09-21

## What the ticket asserts

Scenario 02 ("the census of handlers requiring bridgeServer at module
scope is empty") has fixed Gherkin text: "Then it names exactly
thirty-two handlers." The ticket's own mint commit (`b2858caafc`) census
(`git grep -l 'bridge/bridgeServer' -- 'specs/pipeline/steps/*Steps.js'`
against that commit's tree) is confirmed exactly 32.

## What is true now

The same command against my current worktree tree names 34. Diffing the
mint-time list against the current list shows two pure additions, nothing
removed:

- `specs/pipeline/steps/bl1658SevenJsdomHandlersLoadLazilySteps.js`
- `specs/pipeline/steps/bl1681Bl696SuccessorLeftRedsSteps.js`

Neither is an eager offender — both post-date the mint commit (confirmed
via `git show b2858caafc:<path>`, which fails for both — they did not
exist in that tree) and both only *mention* the literal substring
`bridge/bridgeServer` in a comment (BL-1658's own file) or inside an
already-lazy `lib()` bundle whose require path uses `path.join` with
separate `'bridge'`/`'bridgeServer'` args plus one prose comment line
(BL-1681's own file, which I authored earlier this shift building
BL-1681 — the file did not exist when the specifier minted this ticket
from inside that same BL-1681 work, per this ticket's own notes: "adjudicating
the coder's unowned-red note 000050 (from inside BL-1681)"). The anchored
eager check (`^const .*require(.*bridge/bridgeServer`, column 0) is 0 for
every one of the 34, both before and after my fourteen fixes only differ
by the fourteen files this ticket's fix moves out of the anchored set.

This is the same class of drift BL-1658 itself hit and resolved (its own
"nineteen" → "twenty" cursorBridgeAgentSession census, amendment 4) —
population counts baked into feature-file Gherkin text as fixed English
go stale under a fast-moving swarm where sibling parcels land handler
files between mint and build.

## Disposition

Filing as a spec-gap `note` (priority 00) to the specifier per Article
4.4 — Gherkin authorship stays specifier-only, so I am not editing the
.feature file's "thirty-two" text myself. Requesting the same amendment
shape BL-1658 got: update scenario 02's fixed count to thirty-four (or
whatever the specifier's own re-check finds at amendment time, since the
swarm keeps moving).

Continuing the parcel's other work (the fourteen require-placement fixes,
scenario 01's per-handler checks) while this is pending — none of it
depends on the exact number in scenario 02.

By coder.
