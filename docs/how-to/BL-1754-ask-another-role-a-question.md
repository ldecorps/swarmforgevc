# BL-1754: Asking another role a question with `peer_question.bb`

How a role gets an answer from another role mid-turn without spinning up a
second resident, and without waiting on the mailbox for something that is
only a question.

## The rule this implements

The human, 2026-09-25: mono-router's one-resident rule is its central
tenet — one resident at a time, full stop. But "an agent can spin an
ephemeral other agent if it has a question for it. That is not quite the
same thing as installing a secondary resident." BL-1752 and BL-1753 removed the
daemon-started consult sessions that served real work; this ticket is the
sanctioned replacement for the one case that legitimately needs another
role's judgment right now: a question.

Anything beyond a question — anything that needs the other role to
*change* something (a file, a ticket, a handoff) — is not this helper's
job. Send a `note` instead and let that role's ordinary loop pick it up
(the resident, on a mono-router pack).

## Usage

```
bb swarmforge/scripts/peer_question.bb <project-root> \
    --from <asking-role> --to <target-role> \
    --question "<text>" [--timeout-s <n>]
```

- `<project-root>` is the project root (not a role worktree) — a malformed
  path is a usage error (exit 2).
- `--from`, `--to`, and `--question` are all required; a missing or blank
  one is a usage error (exit 2).
- `--timeout-s` overrides the default wait bound.

The answer is printed on stdout. Exit codes:

| Exit | Meaning |
|------|---------|
| 0 | Answered — the answer is on stdout |
| 2 | Usage error — missing/blank required argument, or a malformed project root |
| 3 | Refused — the target seat's provider does not support this (see below); `claude` was never invoked |
| 4 | Timed out — the child was killed with its process group |
| 5 | The `claude` child exited non-zero for some other reason |

## What actually happens

1. The helper looks up `--to` in `roles.tsv`. If that seat's provider is
   not `claude`, it refuses by name (exit 3) — no non-Claude provider has
   a one-shot read-only mode wired yet.
2. It composes the target role's own prompts (the same composition its
   launch uses) and runs **one** print-mode `claude` call: file-reading
   tools only (no write, edit, or shell tool), the target seat's
   configured model, your question as the user message, prefixed with who
   is asking.
3. The answer is printed to stdout and the call exits 0.
4. Either way — answered, refused, or timed out — one record (from, to,
   question, answer or refusal/timeout reason, timestamps) is written
   under `.swarmforge/peer-questions/`. This is the helper's only durable
   output: it never writes to the repository, a mailbox, or the backlog.
5. On a timeout, the child is killed with its whole process group before
   the helper exits non-zero. No process it started is ever left alive,
   on any exit path.

## What it will never do

- Claim a parcel, drain an intake, or start a tmux session.
- Touch the target role's inbox or in-process work.
- Outlive its own answer — it is a single request/response round trip,
  not a second session.
- Ask a non-Claude seat — that is refused by name, not silently degraded.

## When to use this vs. a `note`

- **Use `peer_question.bb`** when you need another role's judgment on
  something *right now*, mid-turn, and the answer doesn't require that
  role to do anything durable — "does scenario 03 still apply?", "is this
  file still owned by your stage?"
- **Send a `note` instead** when the other role needs to act: change a
  file, update a ticket, or otherwise do work. That work waits for the
  role's own turn (the resident, on a mono-router pack) — a question
  helper is not a way to jump that queue.

## Prompt reference

The constitution's `workflow.prompt`, "Handoff transport", carries the
short form of this rule for every role's boot prefix:

> A question for another role mid-turn (BL-1754): `bb
> swarmforge/scripts/peer_question.bb <root> --from <you> --to <role>
> --question "<text>"` answers once, read-only, then exits (until it
> lands, send a `note`). Work for that role is a `note` and waits for it.
