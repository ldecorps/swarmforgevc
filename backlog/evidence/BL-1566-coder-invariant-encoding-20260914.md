# BL-1566 — declared invariant: stated reason, not a property test (BL-654)

BL-654 requires that each declared invariant leave this parcel either as a
coder-authored executable property test or as a **stated reason** why it
admits no executable encoding — never silently unencoded. BL-1566 declares
one invariant, and it takes the stated-reason path.

- **Author**: coder, 2026-09-14.

## Invariant — "A released hold is never silently dropped"

> A released hold is never silently dropped: the only exit from
> `.swarmforge/qa-holds/<task>.json` is `qa_hold_cli.bb close` with an
> outcome, and no other write, completion or wake removes it.

**Stated reason: it quantifies over the whole call graph — every present
and future caller that could touch the store — not over one pure, testable
module.** A property test can only exercise the functions this parcel
itself wrote (`qa_hold_lib.bb`'s `read-holds`/`hold-file`/`closed-dir`,
`qa_hold_cli.bb`'s `cmd-open!`/`cmd-status!`/`cmd-close!`, the two call
sites in `ready_for_next_task.bb`/`done_with_current_task.bb`). It cannot
prove a negative over code that does not exist yet — a sibling ticket
landing a sweep, a hand edit, a future CLI verb — which is exactly what
"no other write, completion or wake removes it" asserts. Generalizing it
into a filesystem-wide "nothing under `.swarmforge/qa-holds/` is ever
deleted except by `close`" property would need to intercept every file
delete in the process, a different and much larger slice than this
ticket's own three functions.

**The verification the invariant's own subject actually admits, performed
instead** — read from the source, not asserted at runtime:

| claim | verified by |
|---|---|
| `qa_hold_cli.bb`'s `open` command only ever `write-hold!`s to the OPEN store (`qa-hold-lib/hold-file`) — never deletes | `cmd-open!` reads: `(write-hold! (qa-hold-lib/hold-file root task) ...)`, no `fs/delete` call anywhere in the function |
| `qa_hold_cli.bb`'s `status` command is read-only | `cmd-status!` only calls `qa-hold-lib/read-holds`/`register-rows-for`/`open-ticket-ids-for` and `status-lines`, then `println` — no write or delete anywhere in the function |
| `qa_hold_cli.bb`'s `close` command is the ONLY function in the whole ticket that calls `fs/delete` on a hold file | `grep -n "fs/delete" swarmforge/scripts/qa_hold_lib.bb swarmforge/scripts/qa_hold_cli.bb` → exactly one hit, inside `cmd-close!`, and only after the record has already been written to `closed-dir` |
| `ready_for_next_task.bb`'s new call (`print-qa-hold-status-if-any!`) never writes or deletes | function body is `read-holds` + `status-lines` + `println` only — no `spit`/`fs/delete`/`fs/move` |
| `done_with_current_task.bb`'s new call (`qa-hold-gate!`) never writes or deletes | function body is `read-holds`/`register-rows-for`/`open-ticket-ids-for`/`blocks-completion?`/`released-holds` + `handoff-lib/fail!` (which only prints and exits) — no `spit`/`fs/delete`/`fs/move` |

```
$ grep -n "fs/delete\|fs/move" swarmforge/scripts/qa_hold_lib.bb swarmforge/scripts/qa_hold_cli.bb
swarmforge/scripts/qa_hold_cli.bb:            (fs/delete f))
```

That one call sits inside `cmd-close!`, after `write-hold!` has already
placed the outcome-stamped record under `closed-dir` — the delete only
ever follows a successful write to the closed store, never precedes or
substitutes for it.

## Full verification for this parcel

| check | result |
|---|---|
| `bb swarmforge/scripts/test/qa_hold_lib_test_runner.bb` | ALL PASS |
| `node specs/pipeline/cli.js specs/features/BL-1566-an-article-42-hold-is-a-record-qa-resumes-from.feature` | **8/8** scenarios pass |
| `bb swarmforge/scripts/test/suite_inventory_cli.bb` | ok — `qa_hold_lib_test_runner.bb` registered standing, no orphans |
| Manual CLI smoke (open → status unreleased → release via register+backlog → status released → close → status empty) | matches the feature's own shape exactly |
| `ready_for_next_task.bb` as QA with an unreleased hold, empty mailbox | prints both `HOLD` lines, then `NO_TASK` |
| `ready_for_next_task.bb` as QA with a released hold, empty mailbox | first line `RELEASED BL-9000-held abcdef0123`, then `NO_TASK` |
| `done_with_current_task.bb` as QA, released hold, note in in_process | exit 1, prints `HOLD_RELEASED BL-9000-held abcdef0123`, note untouched |
| `done_with_current_task.bb` as QA, released hold, git_handoff in in_process | exit 0, in_process empty (parking never blocked) |
| `done_with_current_task.bb` as QA, hold closed, note in in_process | exit 0, note completed |
