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

## Complete sweep — BL-709 is the ONLY real offender, and 11 look-alikes are not

Done in the same turn so QA's repair is a complete inventory rather than the
one file that happened to be reported (Article 4.4's discipline applied to a
repair request). Every `specs/pipeline/steps/*.js` was checked against
`index.js`'s require list, and the reverse direction too.

**Reverse check: no dangling registrations.** Every `require('./X')` in
`index.js` resolves to a file that exists.

**Forward check: 12 handler files are not required by `index.js`.** Exactly one
is a defect:

| File | Verdict |
|---|---|
| `bl709BubbleItsOwnTelegramTopicSteps.js` | **REAL — the offender.** Exports `{ name, register, ... }`; nothing else references it. |
| `bl623Only.js`, `bl627Only`, `bl636Only`, `bl637Only`, `bl641Only`, `bl642Only`, `bl646Only`, `bl671Only`, `bl694Only`, `bl723Only`, `bl739Only` | **Not offenders — deliberate.** |

The eleven `bl<NNN>Only.js` files are focused entry points, each carrying the
comment *"avoids loading the full steps/index.js, which requires a compiled
extension/out tree"*. Each is a three-line re-export of the REAL handler, and
every one of those eleven targets **is** registered in `index.js` — verified
individually, not assumed. They are unregistered **by design**: registering
them would load the very index they exist to avoid.

## Consequence for BL-1303's guard — an exemption is required

A guard that refuses whenever a `specs/pipeline/steps/*.js` file is absent from
`index.js` would produce **twelve** refusals on `main` today: one true positive
and eleven false ones, on files that are correct. That failure mode is worse
than the defect — it is the shape that gets a guard disabled or normalized away
within a week.

The distinguishing property is available without heuristics on the filename:
a shim's whole body re-exports a module that IS registered, so it registers no
steps of its own. Key the guard on that, or on the FEATURE side — every
`specs/features/*.feature` must be matched by a registered handler — rather
than on the file side. The feature-side framing is the ticket's own title
("A feature on main always has a registered handler") and it has no
false-positive class at all: it asks the question the runner actually throws on.

Do not resolve this by filename pattern (`*Only.js`). That encodes a naming
convention as a security boundary and silently exempts the next real offender
that happens to be named that way.

By specifier.
