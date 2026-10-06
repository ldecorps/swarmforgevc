# BL-2039: why parcels 016946 and 016962 sat in the coder stage queue (2026-10-06)

Investigation of the Operator's intake `INTAKE-operator-question-1791275605027.md`
(archived to `backlog/archive/` in the mint commit), done by the specifier
on 2026-10-06 between 08:52Z and 09:05Z, read-only. No parcel was moved.

## What the intake said

The handoff dispatcher "permanently SKIPS" two coder parcels while
serving every newer one to the same seat:
`10_20261006T052715Z_016946` (Work BL-2022) and
`10_20261006T061803Z_016962` (Work BL-1962), both in
`.worktrees/coder/.swarmforge/handoffs/inbox/new/`.

## What the evidence shows

1. **The two parcels are medium tickets. Every parcel the bare `coder`
   seat served instead was low or carried no ticket.** BL-2022 and
   BL-1962 are `mutation_cost: medium`. The overtaking parcels named in
   the intake: 016951 (BL-1960, low), 016955 (BL-1999, low), 016976
   (BL-1843, low), and five `branch behind ... merge up` notes, which
   name no ticket.
2. **The bare `coder` seat is easy-tier.** `swarmforge/packs/full-forge.conf`:
   `window coder local-model coder --model ista-iq3s-coder:latest --seat-tier easy`
   and `window coder@2 claude coder2 --model claude-sonnet-5 --seat-tier hard`.
   `seat_difficulty_lib.bb`'s `difficulty-claim-decision` answers
   `:skip-ineligible` for an easy seat and a medium ticket (BL-1001:
   "above-tier never lands, however idle the cheap seat is"). The skip is
   that rule. It is durable across a respawn because it is read from the
   pack conf and the ticket.
3. **coder@2 can claim them, and does so in FIFO order.** The coder
   stage queue IS `.worktrees/coder`'s mailbox (`handoff_lib.bb`
   `stage-queue-dir`), and `stage-handoff-files` passes `recipient:
   coder` to coder@2. coder@2 claimed 016877 (Work BL-2025, enqueued
   01:58Z, `recipient: coder`) from that queue at 08:00:24Z. Its
   dequeue timeline since 2026-10-05T22:00Z shows it working Work notes
   and priority-00 bounces back to back (BL-1874, BL-1959, BL-1961,
   BL-1982, BL-1619, BL-1629, BL-1659, BL-2037, BL-2025). At 08:55Z five
   older merge-up notes addressed to coder@2 (02:08Z..05:10Z) sat ahead
   of 016946 in its claim order; merge-up notes take it about 5 s each
   (seven in 31 s at 07:55Z). The two parcels wait for the only hard
   seat. They are not skipped by it.
4. **The defect: the chase sweep chases, and RESPAWNS, the seat that can
   never claim them.** `chase_sweep_lib.bb` sweeps each role's own
   `inbox/new/` and wakes that role (`sweep-role-inbox!` ->
   `apply-inbox-item-action!` with `role` = the mailbox owner). Nothing in
   it reads a seat tier. 016946's sidecar read `{"chaseCount":20}`.
   `.swarmforge/daemon/handoffd.log`:

   ```
   2026-10-06T08:39:10.768444142Z chase-respawn coder ./.swarmforge/launch/coder.sh item=10_20261006T052715Z_016946_from_coordinator_to_coder_for_coder.handoff liveness=unknown heartbeat-age-s= activity-age-s=102.017 busy=false lane=false
   2026-10-06T08:57:09.582940204Z chase-respawn coder ./.swarmforge/launch/coder.sh item=10_20261006T052715Z_016946_from_coordinator_to_coder_for_coder.handoff liveness=unknown heartbeat-age-s= activity-age-s=62.926 busy=false lane=false
   ```

   The iq3 seat was holding BL-1843 in `in_process/` (016976, dequeued
   08:00:35Z) both times. It was respawned twice in 18 minutes over a
   parcel its tier refuses. Each wake before that made it run
   `ready_for_next.sh` for nothing (the NO_TASK spin in the intake), and
   past `maxChases` (3) with the seat responsive the next rung is
   dead-lettering a parcel coder@2 could have claimed. coder@2, the
   one seat that can take the parcel, is never woken for it by this sweep.

## What is not a defect here

- The claim loop's tier refusal (BL-1001) is correct.
- FIFO order across coder@2's union queue (BL-1615) is correct.
- Routing `Work` notes `to: coder` (the stage) is the BL-983 design: the
  stage queue is meant to be claimed by whichever eligible seat is idle.

## Command record

- Served vs stranded vs ticket cost: a loop over the coder mailbox's
  `completed/`, `in_process/` and `new/` files, reading each `message:`
  header's ticket id and that ticket's `mutation_cost:`.
- coder@2 timeline: every `dequeued_at:` header since 2026-10-05T22:00Z
  in `.worktrees/coder2/.swarmforge/handoffs/inbox/{completed,in_process}`
  and `.worktrees/coder/.swarmforge/handoffs/inbox/completed`.
- `grep "chase-respawn coder " .swarmforge/daemon/handoffd.log`.
- `.worktrees/coder/.swarmforge/handoffs/inbox/respawn-cooldown.json`
  read `untilMs 1791277327592` at 08:57:50Z, i.e. the 08:57:09Z respawn.
