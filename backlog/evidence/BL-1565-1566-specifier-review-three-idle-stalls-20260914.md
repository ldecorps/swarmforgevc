# Specifier review of the coordinator's "3x resident self-typed-unsubmitted idle stalls" note, 2026-09-14

Inbound: coordinator note 008280 (12:32:43Z, priority 20): "3x resident
self-typed-unsubmitted idle stalls this shift - review".

## Finding 1: there was no self-typed input

The coordinator read text after the `❯` in the idle resident pane ("check
tmux list-sessions again in a bit", "check active_backlog_max_depth in
swarmforge.conf again") as an instruction the resident typed and never
submitted, and nudged the coder (008265, 11:02Z; again ~12:30Z). Its own
transcript at 13:36 local: "The operator's diagnosis was correct - the real
stall was a missing dispatch link, not the coder idling."

That band is the Claude Code TUI's own render: a dim next-prompt suggestion
(`^[[2m`, confirmed 2026-07-14) or a stale repaint of a prompt already
submitted (2026-09-06, `approve BL-1444` in the specifier pane - two Enters
changed nothing, the buffer was empty). The literal-character probe
(`send-keys -l X`, capture, `BSpace`) found an EMPTY buffer on 2026-09-06,
09-10 ("check ready_for_next.sh again" was a dim placeholder) and 09-13. No
occurrence of such text has ever appeared in `inject-traffic.log`. A nudge
to that pane returns `NO_TASK` and resets nothing but the coordinator's own
idle clock.

## Finding 2: the three stalls had two real causes, both unminted

| swarm-starved fire (Z) | active ticket | real cause | minted as |
|---|---|---|---|
| 09-13 23:25 | BL-1527 | QA's post-land close arrived as `git_handoff merge_and_process` `non-forwarding: true` (002673); coordinator completed it merge-only per Article 2.4 and waited for a note that never comes; self-diagnosed ~23:20Z | BL-1565 |
| 09-14 11:00 | BL-1563 | same shape, parcel 002698 (10:43Z); coordinator nudged the coder instead (008265); operator note 008266 at 11:03Z named the parcel as the close | BL-1565 |
| 09-14 12:25 / 12:30 | BL-1555 | QA withheld on the bl1297 unowned red (evidence c859adced9) and completed the parcel; owner BL-1564 minted 12:05Z, resume note 001539 reached QA 12:16Z and was completed in 10 s with nothing resumed; operator pointer 12:35Z; coordinator note 008282 to QA 12:36Z | BL-1566 |

Census of `git_handoff` arrivals at the coordinator (`coordinator/inbox/
completed/`): ten closes 07-09..08-30 with no stamp, all bookkept; five
since BL-1536 landed (09-08..09-14) stamped `non-forwarding: true`, of
which the last two starved the swarm. Three prose sites sanction the
git_handoff shape (QA.prompt "Notify the coordinator with a `git_handoff`
or `note`", coordinator.prompt "When QA passes a parcel (`git_handoff` or
`note`", handoff-protocol.md merge-up step 3) against Article 2.2 ("a QA
merge-up signal is a note") and Article 1.1 (coordinator: no code
commits). BL-1536's own feature narrative names "QA's approved commit to
the coordinator, which nobody forwards again" as the stamped terminal
forward - the hop this review retires.

For the hold: QA's mailbox shows parcel 001272 (documenter -> QA, BL-1555)
completed, then 001539 dequeued 12:16:49Z and completed 12:16:59Z. The
hold existed only as evidence prose; nothing told QA which commit to
re-gate, nothing refused the completion, nothing re-surfaced the hold on
the next turn.

## Disposition

- `process_ticket` x2: BL-1565 (a git_handoff to the coordinator is refused
  at send; the close is a note) and BL-1566 (an Article 4.2 hold is a record
  QA resumes from). Both `type: defect`, `severity: high`, epic
  swarm-reliability, `human_approval: pending`.
- Prose landed on `main` in the mint commit (BL-798: mine to land, no gate
  reminds me): QA.prompt close bullet and Article 4.2 bullet,
  coordinator.prompt "QA approval" section and a swarm-starved diagnosis
  order (mailboxes and register first, pane band never), specifier.prompt
  standing-red bullet (tell the holder the same pass),
  handoff-protocol.md merge-up step 3.
- IR-DRY on both features: BL-1565 zero findings; BL-1566's nine are
  placeholder variants of one step pattern each (`the ticket "<x>" sits in
  "<y>"`, `it exits (zero|non-zero)`, HOLD lines per red) and
  medium-confidence synonyms between distinct assertions - read and kept.
- Not minted: the ghost-render misread itself. It is a reading error with a
  five-second probe already on record, now written into coordinator.prompt;
  a mechanical "is the buffer empty" check belongs to babysitterd's sweep
  if it recurs after the prompt lands.

By specifier.
