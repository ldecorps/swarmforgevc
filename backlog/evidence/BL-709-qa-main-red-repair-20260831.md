# BL-709 — QA repair of an unregistered handler, plus a newly-exposed regression, 2026-08-31

Not a bounce. QA-exclusive infrastructure repair (`specs/pipeline/steps/` is
QA-only on `main`, `check_pipeline_code_on_main.sh`), triggered by a
priority-`00` note from the specifier naming
`backlog/evidence/BL-1303-second-live-offender-bl709-20260831.md`: BL-709's
handler was dropped from `specs/pipeline/steps/index.js` by a silent-revert-
by-merge (`45625ef9cb`, 2026-08-27, the BL-571/958/954 shape — took the
merge parent without the require line, no conflict, no signal), four days
after BL-709 shipped with `human_approval`/QA pass evidence dated
2026-08-27.

## Repair (landed)

`specs/pipeline/steps/index.js` — re-added
`require('./bl709BubbleItsOwnTelegramTopicSteps'),` next to `bl710`/`bl711`
(both Telegram/Bubble-topic siblings), restoring exactly what `b3ddc2e692`
("fix(BL-709): register bl709 steps in index.js. By documenter.") originally
landed.

## Verification after the registration repair — NOT clean, and that is new information

```
node specs/pipeline/cli.js specs/features/BL-709-bubble-its-own-telegram-topic.feature
```
Before repair: 8 tests, 0 pass, 8 fail (`no step handler matched`, matches
the specifier's own finding). **After repair: 7 pass, 1 fail — deterministic
across two runs.**

Failing: scenario `BL-709 bubble-topic-07`, "an unbound Bubble topic falls
back to the previous behaviour" — step `Then the turn is mirrored into the
Cursor Remote topic as before` fails `assert.ok(ctx.sent.length >= 1)`: zero
messages are sent when no Bubble topic is bound, not a fallback to the
Cursor Remote topic.

**Root cause, read from source, not guessed**: `mirrorLetsTalkTurnToBubble`
(`extension/src/bridge/bridgeServer.ts:241`) resolves its target topic via
`bubbleMirrorTopicForPath` (`extension/src/bridge/bubbleMirrorTopic.ts:71`),
which by its own doc comment ("Prefer the dedicated Bubble topic; never dump
ordinary talk onto Cursor Remote") deliberately returns `undefined` when
unbound and has no fallback — then `mirrorLetsTalkTurnToBubble` early-returns
on `undefined` (line 252-254) and sends nothing. The correct fallback
resolver already exists and is exported right next to it —
`effectiveLetsTalkMirrorTopicId` (`bridgeServer.ts:160-166`), whose own doc
comment states the exact contract this scenario asserts ("Bound dedicated
Bubble → Bubble only; unbound → previous Cursor Remote mirror") — but
`mirrorLetsTalkTurnToBubble` never calls it. This is not something my
registration fix caused; it was masked by the missing registration (all 8
scenarios failed identically with "no step handler matched", so nobody could
see 7 pass and 1 fail on its own merits) and is now visible for the first
time since 2026-08-27.

**Also missing, same shape, not further diagnosed here**: BL-709's own
dedicated property file, `extension/test/bl709BubbleOwnTelegramTopic.property.test.js`
(4/4 passing at the original 2026-08-27 QA pass per
`backlog/evidence/BL-709-qa-pass-20260827.md`), no longer exists on `main` —
`git log --follow` on that path stops at BL-709's own hardener commit
(`6138b79da6`) with no later delete commit, the same "dropped with no
signal" shape as the `index.js` line. `extension/test/letsTalkBridge.test.js`
also shipped with BL-709 coverage (45/45 tests at the original pass) and now
runs 42/42 with zero remaining reference to BL-709, "Cursor Remote", or
"unbound" fallback behavior — 3 tests' worth of this exact coverage is gone
from the unit lane too.

## What I did NOT do

Did not touch `extension/src/bridge/bridgeServer.ts` or
`bubbleMirrorTopic.ts`, and did not attempt to restore the missing property
file or the 3 missing unit tests. That is source/test content in the normal
pipeline's domain (coder/hardener), not `specs/pipeline/steps/` — outside
QA's exclusive repair lane and outside QA's mandate ("do not introduce new
behavior").

## Orphan check

`pgrep -fl 'node --test|stryker'` clean before and after.

## Disposition

Landing the registration line directly on `main` (QA-exclusive path,
`SWARMFORGE_ROLE=QA`) — it is unambiguously correct and was the specifier's
explicit ask. Sending the specifier a priority-`00` note naming this file:
main is no longer silently red (unregistered handler), but is now openly red
for a real, previously-masked reason (BL-709's own documented fallback
contract is unimplemented) plus two lanes of lost test coverage for the same
behavior. This needs a fresh ticket and the normal pipeline (coder), not a
second QA-exclusive repair — the fix is a real logic change to production
TypeScript, not infrastructure/registration.
