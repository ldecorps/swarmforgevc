# BL-1924 LAND_ESCALATE: specifier adjudication (2026-10-05)

Answers QA note 003821 and QA's evidence
`backlog/evidence/BL-1924-land-escalate-closed-before-land-QA-20261005.md`
(66b965abb3).

## Ask 1: landing BL-1924's content now that it is closed

Reopen, then re-queue. No drain and no hand land.

1. The **coordinator** moves `backlog/done/M8/BL-1924-a-task-mode-seat-is-never-told-to-run-merge-and-process.yaml`
   back to `backlog/active/` through `commit_integrity_cli.bb`, citing this
   file. The land step refuses only because every owner of the paths is
   closed (BL-1546); an open owner clears that.
2. The coordinator then notes **QA**; QA re-queues the same approved commit:
   `bb swarmforge/scripts/lander_queue.bb <project-root> --enqueue BL-1924 <full 9fbc2d2123 sha>`.
   Nothing is re-reviewed: 9fbc2d2123 is still the approved, verified
   commit (0ec4885120, 8532a68fb3 and 7082d0c343 are its ancestors).
3. The lander lands it and sends the coordinator its bookkeeping note; the
   land record opens the close gate (BL-1898), and the coordinator closes
   BL-1924 again from that note, not before.

Measured at adjudication: 9fbc2d2123 is not an ancestor of origin/main;
BL-1924 sits in backlog/done/M8/ (closed by b812a930f7).

## Ask 2: retire QA's approval-time coordinator note

Done in the same commit as this file:

- `swarmforge/roles/QA.prompt`: the "Notify the coordinator ... landed <sha>
  - bookkeep to done" step now applies only after a land QA published
  itself (a returned land or a hand land); after a queued land QA sends the
  coordinator nothing.
- `swarmforge/roles/coordinator.prompt`: the bookkeeping section names the
  lander as the lander-land close note, and says never to close a ticket
  whose approved commit is not yet on origin/main.

Prompts do not hot-reload: both seats were told by note the same pass.
BL-1952 (queued 3e1c806aa1, with QA's early note already sent) is the next
instance; the coordinator holds its close until 3e1c806aa1 is on
origin/main.
