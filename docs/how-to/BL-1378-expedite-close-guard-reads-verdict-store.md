# Closing an expedite-run ticket to `backlog/done/` (BL-1378)

## The gap this closes

`commit_integrity_cli.bb`'s close guard (`ticket_close_guard_lib.bb`,
BL-419/BL-869) used to allow an `active/`/`paused/` → `backlog/done/` move
only when it found a `git_handoff` or `note` **from QA** in the
coordinator's own mailbox naming the ticket id. `expedite.sh` runs with the
whole stack stopped and is forbidden by design from touching handoffd, the
mailboxes, tmux, rotation, or the coordinator (`docs/how-to/BL-567-expedite-one-ticket-with-the-swarm-stopped.md`)
— so that precondition was not merely unmet for one expedite-closed ticket,
it was **unsatisfiable for every one of them, permanently**. The only ways
past it were bypassing the guard or forging a QA handoff.

## The fix: a second approval path, read alongside the mailbox

The guard now also consults the durable record the expeditor already
writes at its own QA hat and that `is_qa_ancestor.sh` already trusts:
`.swarmforge/expedite-approvals/<month>.jsonl`, one JSON line per verdict
(`{"ticket":"BL-1375","stage":"QA","approval":true,"commit":"c370d1e28a",...}`).
**The mailbox check decides first and decides alone** — a store that
cannot be read must never break a close the mailbox already approved. Only
when the mailbox check finds nothing does the expedite store come into
play, and only as a genuine second path (BL-925 invariant 2: "one predicate,
one more approval path, never a second definition of approval"), never a
weaker substitute.

A record only approves when it names the closing ticket, `stage: "QA"`,
and `approval: true` together — a record for a different ticket, a
different stage, or `approval: false` never rescues a close.

## Landing is required too (the human's ruling, 2026-09-03)

Two options were on the table: require the expedite QA verdict record
alone, or require it **and** that the approved commit is an ancestor of
`main`. The human chose the stricter one — otherwise this fix would make
official exactly the situation BL-1375 was caught in: a ticket sitting in
`backlog/done/` whose code is on no branch anyone reads (see BL-1376, the
sibling ticket that fixed the expedite handover's own silence about this).
So a valid, matching record still isn't enough on its own: the guard also
checks `ancestor-of-main?` for the record's `commit`, and:

- **ancestor** → close allowed, the record and commit named in the detail.
- **not an ancestor** → refused, naming the commit that hasn't landed.
- **undeterminable** (the ancestry check itself couldn't answer) → refused.
  An unanswerable question is never treated as yes.

Practically: an expedite-closed ticket cannot reach `backlog/done/` until
QA has actually landed its branch on `main` — the close guard and BL-1376's
OUTSTANDING-handover fix now point at the same requirement from two
directions.

## Fails closed, always named

A store that's missing is read as "no expedite path at all" — it falls
back to the mailbox check's own `missing-qa-approval` refusal, never as an
approval. A store that's obstructed (a file where the directory should be),
unreadable, or holds a line with no `commit` or no `approval` field refuses
with the specific problem named — never silently treated as absent, and
never guessed past.

## Verifying

1. A ticket with a valid, matching expedite QA record whose commit IS an
   ancestor of `main`: confirm the close is allowed, naming the record.
2. Same ticket, no QA mailbox handoff either: confirm today's
   `missing-qa-approval` refusal, unchanged, when there's no record at all.
3. Normal path: QA mailbox handoff present, no expedite record — confirm
   the close is allowed exactly as before.
4. Record present but `approval: false`, then wrong `stage`, then naming a
   different ticket: confirm each refuses.
5. Store obstructed, then unreadable, then missing `commit`, then missing
   `approval`: confirm each refuses and names the specific problem.
6. Record valid but its commit is NOT an ancestor of `main`: confirm the
   close is refused, naming the commit.

## Out of scope

Making the expeditor use the mailboxes (reverses BL-567's whole premise).
Landing `expedite/BL-1375` itself — that's QA's own act (Article 1.8/4.2,
BL-247). The handover reporting gap that surfaces an unlanded branch in the
first place (BL-1376, a separate ticket).

Acceptance: `specs/features/BL-1378-an-expedite-closed-ticket-can-never-satisfy-the-close-guard.feature`.
