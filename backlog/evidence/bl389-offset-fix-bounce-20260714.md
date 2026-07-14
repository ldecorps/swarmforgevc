# BL-389 production bounce — 2026-07-14 15:11

## Failing observation (production, not a test)

BL-389 closed QA-approved at 14:43 (`5e91c235`, merge `e85fbeac`). The human
then pulled main, recompiled (`npm --prefix extension run compile`) and
relaunched the front desk (~15:11). Within seconds the redelivery flood
RESUMED on the FIXED build:

```
0e2caf4d 15:12:08 BL topic record for BL-359
0f01acf9 15:12:08 BL topic record for BL-359
b823abbf 15:11:53 BL topic record for BL-359
393a6ee9 15:11:53 BL topic record for BL-359
```

Same ~15-second cadence as the original incident (prior flood tail:
`c415724d`/`72a9eb9b` at 11:38:59). Detected by an external monitor watching
origin/main; the human killed the front desk again immediately. Total new
junk commits this recurrence: 4 (monitor fired within ~2 minutes).

## Failure class

`behavior` — the shipped fix does not handle the LIVE incident it was
specced from. This was scenario-zero: the intake and the specifier's own
fork question stated "the parked offset lives on Telegram's side, so
restarting the bot does NOT clear it — it will resume flooding
immediately." The ticket's title promise ("a dropped message must not park
the offset") appears to have been implemented for NEW drops going forward,
while the ALREADY-parked offset from the 10:54 incident — still sitting on
Telegram's side, minted by the pre-fix build — replays on connect and is
evidently not recognised/acked past by the fixed build.

## Expected vs observed

Expected: on restart with a poisoned pending update queued server-side, the
fixed bot acknowledges past it exactly once (terminal drop: offset
advances, no side effects re-fired, at most one log line), and the topic
record gains ZERO new commits.

Observed: replayed update(s) re-fired the full side-effect chain — topic
record rewrite, commit, push — twice per ~15s poll cycle, identical to the
pre-fix behavior, on build compiled from post-fix main.

## What to verify before re-landing

1. The offset-advance/terminal-drop path runs for updates that were dropped
   by a PREVIOUS process generation (persisted drop decision), not only for
   drops decided within the current process's lifetime.
2. Whatever marks "this update is already handled/dropped" is durable and
   consulted BEFORE side effects, keyed by Telegram update_id.
3. A regression scenario that stages the exact production shape: server
   holds a pending update whose drop was decided pre-restart; bot restarts;
   assert offset advances with zero commits minted. (Per the hardener's own
   fixture rule: make sure the fixture does not pre-ack the update and
   thereby prove the easy case.)
4. Cheap belt-and-braces given two live incidents: BL-390's
   churn-does-not-mint-a-commit guard would have capped the blast radius to
   zero commits even with the replay — worth confirming it is sequenced
   soon.

## Human decision standing

Front desk goes DOWN again immediately (done, ~15:14) and STAYS DOWN until
a fix demonstrably survives the restart-against-poisoned-offset case.

## Addendum 16:07 — second manifestation: Telegram spam without commits

The bot from the ~15:11 relaunch was still alive at 16:07 (the earlier kill
either was not executed or did not take). New symptom shape:

- The EPIC — Swarm Role Benchmark topic received "3 of 6 ticketed slice(s)
  complete." roughly EVERY MINUTE from 15:13 through at least 16:07 (104
  messages in the topic, 74 unread in the human's client).
- Git side is QUIET this time: still exactly 213 `BL topic record for
  BL-359` commits, none after 15:12:08. The replay's commit-minting side
  effect stopped; its MESSAGING side effect did not.

Two candidate mechanisms for the spec to separate:
1. The same parked-offset replay, with the BL-389/390 work suppressing the
   topic-record commit but NOT the epic-progress announcement — i.e. the
   drop is still not terminal; only one of its side effects got guarded.
2. An independent BL-341 defect: the epic progress announcer fires per
   poll/event instead of on PROGRESS CHANGE ("3 of 6" never changed across
   an hour of messages — a change-gate would have sent zero).

Either way the acceptance bar from this bounce stands and extends: after a
restart against a poisoned offset, ZERO repeated side effects of ANY kind —
commits, topic messages, emails — not just zero commits. "3 of 6" said
once is a feature; said 60 times it is the flood with a friendlier face.
