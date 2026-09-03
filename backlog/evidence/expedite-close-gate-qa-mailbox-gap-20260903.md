# DEFECT to mint: expedite-closed tickets can never pass the QA-approval close gate

## What happened
BL-1375 (land-queue deadlock, critical) ran through `expedite.sh` (BL-567) with
the swarm stopped. All stage hats, including QA, passed — recorded in
`swarmforge/runtime/expedite-BL-1375.log`. The fix landed on `main`. The
run's OUTSTANDING block handed the coordinator the `active/`+`paused/` ->
`done/` backlog move to commit deliberately, per
`docs/how-to/BL-567-expedite-one-ticket-with-the-swarm-stopped.md`
("uncommitted backlog moves").

`commit_integrity_cli.bb`'s close guard
(`swarmforge/scripts/ticket_close_guard_lib.bb::qa-approved-ticket?`, BL-419/
BL-869) hard-requires a `git_handoff` or `note` **from QA** sitting in the
coordinator's own mailbox and naming the ticket id before it will commit an
`active/` -> `done/` move.

`expedite.sh` is deliberately designed (BL-567) to "never touch handoffd, the
mailboxes, tmux, rotation or the coordinator" while the stack is stopped. So
no expedite-run ticket can ever place a QA handoff in the coordinator's
mailbox — the close guard's precondition is structurally unsatisfiable for
every expedite-closed ticket, not just BL-1375.

## Reproduction
1. Run `expedite.sh <BL-id>` to completion (QA verdict pass).
2. As coordinator, attempt to commit the resulting `active/`+`paused/` ->
   `done/` move via `commit_integrity_cli.bb`.
3. It refuses: `CLOSE BLOCKED ... no QA git_handoff or note to coordinator
   referencing this ticket.`

## Evidence
- `swarmforge/runtime/expedite-BL-1375.log` — stage verdicts including QA
  `pass`, and the OUTSTANDING block naming the coordinator as committer.
- `swarmforge/scripts/ticket_close_guard_lib.bb` `qa-approved-ticket?` — the
  literal precondition (`from = "QA"` in coordinator mailbox).
- `swarmforge/scripts/expedite_lib.bb` line ~729 comment: "The expeditor may
  not use handoffd, the mailboxes, tmux, or the coordinator."

## Human ruling (2026-09-03, via coordinator role_ask)
Route this as a defect for the specifier to mint. BL-1375's own close move
stays staged, uncommitted, until this lands — do not bypass the gate.

## Suggested shape (specifier's call, not prescribed)
Give the close guard an expedite-aware exception — e.g. accept durable
evidence already written by `expedite.sh` itself (the run log's per-stage
`pass` verdicts, or a marker file it could write at teardown) as equivalent
proof to a QA mailbox handoff, scoped only to tickets the expedite log shows
as its own run ticket. Must not weaken the guard for the normal pipeline
path — that gate is exactly what stops BL-1332-class silent closes.
