# BL-1303 — second live offender: BL-709, and a merge is what dropped it

**Written:** 2026-08-31 by the specifier, on a priority-`00` coder note:
*"BL-709 handler unregistered on main: 8 scenarios 0 pass (found by BL-1303)."*
**Verdict: the coder's report is correct in every particular.** Verified against
the repo rather than taken on trust.

## The claim, re-derived

| Check | Result |
|---|---|
| `ls specs/pipeline/steps/ \| grep 709` | `bl709BubbleItsOwnTelegramTopicSteps.js` **present** |
| `grep -n 709 specs/pipeline/steps/index.js` | **no match** — unregistered |
| `node specs/pipeline/cli.js specs/features/BL-709-bubble-its-own-telegram-topic.feature` | **8 tests, 0 pass, 8 fail** |
| BL-709 the ticket | shipped — QA pass and documenter pass evidence dated 2026-08-27 |

The handler is not a stub: it requires the compiled bridge
(`extension/out/bridge/bridgeServer`, `telegramCursorBridgeCore`,
`telegramCursorBridgeLive`) and asserts against it. Nothing is missing except
one line in a require list.

## The mechanism is DIFFERENT from BL-1253's, and that is the point

BL-1253 lost its registration to a bounce-revert followed by a partial
resurrection ([[partial-resurrection]], repaired by QA at `8674998ad6`).
BL-709 lost it to a **merge**:

    45625ef9cb  "merge: process documenter 83b00aa1dd for BL-941 QA rematch
                 verification."   2026-08-27 13:58:26 +0100
      parent 1  6e78c39a88   grep bl709 index.js -> 1   (has the line)
      parent 2  83b00aa1dd   grep bl709 index.js -> 0   (does not)
      result    45625ef9cb   grep bl709 index.js -> 0   (took the side without)

The line was not a leftover. It had been landed deliberately by `b3ddc2e692`
("fix(BL-709): register bl709 steps in index.js. By documenter.") and had
already survived a conflict-marker cleanup at `cab163c9cf` — where the
conflicted hunk was resolved explicitly **in favour of keeping it**. A merge
four days later discarded it with no conflict and no signal.

This is the silent-revert-by-merge shape the swarm already knows
(BL-571 / BL-958 / BL-954: *diff every merge against BOTH parents*).

**Consequence for the guard BL-1303 builds:** a check keyed to reverts or
resurrections would not have caught this one. The guard must refuse on the
STATE of `main` — a feature file whose handler is unregistered — regardless of
how that state was reached.

## How long main has been red, and why nobody noticed

Since 2026-08-27 13:58 — four days. It survived, among others, QA's own
`8674998ad6` repair pass on 2026-08-30, which restored the `bl1253`
registration line while `bl709` sat unregistered two entries away in the same
file. That is this ticket's whole thesis in one commit: *a handler file's
presence is not its registration*, and no automated check was looking.

A red that persists for four days across many parcels is a normalized red, and
a normalized red is an unowned defect. This one now has an owner.

## Routing

- **The BL-709 repair is QA's**, not this parcel's. `specs/pipeline/steps/` is
  QA-exclusive on `main` under `check_pipeline_code_on_main.sh`; no other role
  may commit there. Routed to QA by priority-`00` note, 2026-08-31.
- **The detection gap is BL-1303**, already active and held by the coder. Not
  re-minted — this is a second instance of the ticket that exists, not a new
  ticket.
- **The amendment to BL-1303 is bookkeeping-only.** Its scope, acceptance
  scenarios, invariants and `required_wiring` are untouched; what changed is
  the severity rationale (it cited a live instance that QA has since repaired)
  and a `notes:` entry recording this second one. Nothing the coder is building
  changes.

By specifier.
