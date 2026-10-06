# Intake: a question the Operator could not answer

Filed by the Operator (2026-10-06T08:33:25.027959223Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

HUMAN-DIRECTED DEFECT MINT (severity: high). The human was asked in SUP-17 how to fix the dispatcher parcel-skip described below and answered verbatim: "Mint a high-severity defect ticket for the swarm". So this intake is not an open question - it is a human-directed instruction to mint a high-severity defect ticket. Specifier: please mint it; the Operator deliberately did not mint, promote or hand-move anything.

DEFECT: the handoff dispatcher permanently SKIPS two specific coder work-parcels while serving every newer parcel to the same seat.

Stranded parcels (live bare 'coder' seat, iq3, worktree .worktrees/coder, mailbox .worktrees/coder/.swarmforge/handoffs/inbox/new/):
- 10_20261006T052715Z_016946_from_coordinator_to_coder_for_coder.handoff - ticket BL-2022 - enqueued 2026-10-06T05:27:15Z - age 3h05m at 08:32Z - chaseCount 18
- 10_20261006T061803Z_016962_from_coordinator_to_coder_for_coder.handoff - ticket BL-1962 - enqueued 2026-10-06T06:18:03Z - age 2h14m at 08:32Z - chaseCount 9

Both still sit in new/ with no dequeued_at. Both were DELIVERED fine: inject-traffic.log records outcome=ok sync-deliver at 05:27:16Z and 06:18:04Z. So the fault is parcel SELECTION, not delivery.

Discriminating facts (already verified by the Operator - no need to re-derive):
1. Newer parcels overtake them continuously, before AND after a full restart: 016951, 016955, 016956, 016958, 016959, 016971, 016972, 016975 all reached completed/; 016976 (07:06:20Z) is in in_process/ now. 016975's served copy carries dequeued_at 07:52:57Z, i.e. 27 minutes AFTER 016962 was already waiting.
2. THE SKIP SURVIVED A FULL CONTROL-PLANE LOSS AND SEAT RESPAWN. The tmux socket went missing, babysitterd ran './swarm ensure', all 10 seats restarted at 08:00Z - and these same two parcels are still skipped. That rules out a stale in-memory cursor or a wedged pane: the refusal is durable and on disk, and specific to these two parcels.
3. They are indistinguishable from the parcels that WERE served: same priority 10, same 10_ filename prefix, same _from_coordinator_to_coder_for_coder addressing, to: coder, recipient: coder.
4. Both tickets are legitimately the coder's: in backlog/active/, status: todo, human_approval: approved, coder is the FIRST entry of required_stages (BL-2022 [coder, qa]; BL-1962 [coder, architect, qa]).
5. Not a worktree/mailbox mix-up: the seat's cwd IS .worktrees/coder and that mailbox's completed/ holds parcels served as recently as 07:05Z, so it is the live serving path (not the retired .worktrees/coder-iq3 orphan mailbox). ready_for_next.bb/ready_for_next.sh in that worktree are byte-identical to origin/main, so the dispatcher is not drifted.

WHY HIGH SEVERITY / cost of leaving it: BL-2022 and BL-1962 hold 2 of the 7 backlog/active/ slots and can never start, and there is NO auto-recovery. The coordinator's 08:02Z sweep read the board as healthy ('Active backlog: 7 tickets, at the effective cap of 7 - all already routed') and went idle, so the cap stays full and throughput is throttled indefinitely. One targeted Operator nudge to the coordinator at 06:26:30Z did not take. Earlier in the incident the same shape had the seat in a NO_TASK spin, which risks the loop_detect_lib.bb / handoffd.bb:1361 hard-stop circuit breaker halting the WHOLE swarm; that risk receded only because an unrelated restart happened to give the seat other work.

FULL EVIDENCE WRITE-UP (please read before specing, it records everything already ruled out): .swarmforge/operator/NOTE-coder-no-task-spin-20261006.md

The Operator has NOT run ready_for_next.sh, sent a keystroke to the coder pane, respawned the seat, or moved/abandoned/re-enqueued any parcel - the two parcels are preserved in new/ as live reproduction evidence. Suggest the ticket's first step be to reproduce the NO_TASK/skip decision for parcel 016962 from .worktrees/coder, since the evidence is still on disk and will be destroyed by any hand-remedy.
