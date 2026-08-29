# BL-1236 — thirteenth reset: six human approvals and two ticket closures destroyed, 2026-08-28

Found while adjudicating a coder note ("BL-1236 routed to me but
`human_approval: pending`, holding"). The coder was right to hold, and its
confusion is a symptom, not an error: **the ticket was reset out from under it
42 seconds after it was routed.**

## The reset

    88059cd55 main@{2026-08-28 13:38:41 +0100}  reset: moving to origin/main

Twelve commits discarded (`git log 88059cd55..0e7027bc3`), all authored in the
four minutes before it:

    0e7027bc3 13:38:01  Approve BL-1246: record human_approval
    1e1b73a21 13:38:01  Approve BL-1245: record human_approval
    b1682495b 13:38:01  Approve BL-1244: record human_approval
    13c64eda4 13:38:00  Approve BL-1226: record human_approval
    3414335c4 13:38:00  Approve BL-1225: record human_approval
    0b2961e8c 13:37:59  Approve BL-1224: record human_approval
    b72eaa80b 13:37:59  Ambulance BL-1236: restore JumpQ active after reset + engage hold
    c9bf524bd 13:36:55  Merge remote-tracking branch 'origin/main'
    d1c4801ed 13:36:44  Close BL-1228: move to done (QA approval cb742b22b8 verified
                        ancestor of main; original close was dropped during the reset chaos)
    d82e06d21 13:35:11  BL topic record for BL-1192
    d158768a7 13:35:00  Close BL-1192: move to done
    8f0d96570 13:34:57  Restore BL-1192 ticket file to backlog/active/ (misplaced at
                        backlog/paused/ by an entangled merge during the reset chaos)

## What this occurrence destroyed that no previous one did

**Six human approvals, in a single stroke.** Every one is back to `pending`,
verified on disk after the reset:

    BL-1224 pending   BL-1225 pending   BL-1226 pending
    BL-1244 pending   BL-1245 pending   BL-1246 pending

The human tapped approve on six tickets at 13:37:59-13:38:01 and forty seconds
later all six taps were gone. **BL-1247, approved at 13:39:58 — after the
reset — survives.** That is the whole difference between the two groups.

**This is a new class of loss.** Prior occurrences destroyed spec commits and
product code (recoverable, and their absence is visible as missing work). An
erased approval is invisible: the ticket reads exactly as if the human had
never answered, so the natural response is to ask again — and the human sees a
system that ignores their decisions.

**Two ticket closures destroyed as well**, both of shipped work:

- **BL-1192** — QA-approved and landed (`27eadb5dad` is an ancestor of `main`),
  now sitting in `backlog/paused/`, not even `active/`. A shipped ticket parked
  where the coordinator can promote and re-work it.
- **BL-1228** — back in `backlog/active/`. Its own commit message records that
  this is the **second** time its close has been destroyed ("original close was
  dropped during the reset chaos").

**And it destroyed the ambulance engagement set up to fix the reset itself**
(`b72eaa80b`), which is why `.swarmforge/operator/control-ambulance.json` still
names BL-1236 as patient while BL-1236 sits in `backlog/paused/` — a state
`ambulance_lib.bb:210` explicitly refuses to create ("promote it before
engaging; ambulance does not auto-promote"). The marker outlived the promotion
that justified it.

## Recoverable

    git cat-file -e 0e7027bc3   ->  still reachable

The pre-reset tip survives in the reflog and carries all twelve. `origin` has
none of them (`git branch -r --contains 0e7027bc3` is empty), so the reflog is
the only copy. Do **not** run `git gc` or `git prune`.

## Why it matters for BL-1236 and BL-1248

BL-1236 is the fix for the predicate that causes these resets, and it is
blocked on `human_approval: pending`. This occurrence shows that **an approval
is not durable**: the human can tap approve on BL-1236 and have the tap erased
by the very defect the approval was meant to authorise fixing. The loop is
closed and it does not open on its own.

BL-1248 (the config kill switch, shipped OFF, minted 13:44 in response to the
human's 12:16Z directive) is the unblocked half — but it is `pending` too, so
its approval is exposed to the same erasure. Whoever taps either should verify
afterwards that the approval commit is an ancestor of `origin/main`, not merely
present locally.

By specifier.
