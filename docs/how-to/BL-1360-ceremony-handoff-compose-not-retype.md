# Composing a fixed pipeline ceremony instead of hand-typing it (BL-1360)

## What it is

Two pipeline sends carry no judgement at all — only a ticket id and (for
one of them) an approved commit vary, everything else is already fixed by
`swarmforge/handoff-protocol.md`:

- **`bookkeep`** — QA telling the coordinator to move the ticket to done and
  promote the next, priority `00`.
- **`spec-ready`** — the specifier telling the coordinator a paused ticket is
  ready to promote, priority `00`.

Before this, the sending role hand-wrote the draft each time, re-read
`handoff-protocol.md` to confirm the recipient list, and measured the
message against the 80-character note cap with `wc -c`. Observed
2026-09-03: one QA seat spent 16m06s and 58.6k tokens composing two of
these notes. `ceremony_handoff.sh` composes the draft from one definition
instead.

A third ceremony, `merge-up` — QA's broadcast telling every worktree role
to merge up to the approved commit — retired with BL-1902: a role on
parcel lines (BL-1871) merges nothing, so a broadcast whose only effect on
each recipient was to be completed is a handoff no one sends any more.

## Usage

```
swarmforge/scripts/ceremony_handoff.sh <ceremony> --ticket BL-042 [--commit a1b2c3d4e5] [--dry-run]
```

`<ceremony>` is one of `bookkeep`, `spec-ready`. `bookkeep` needs both
`--ticket` and `--commit`; `spec-ready` needs only `--ticket`. `--dry-run`
prints the composed draft and sends nothing — useful for checking the
composition once instead of re-deriving it every time.

## It is a front end, never a second way into a mailbox

`ceremony_handoff.bb`/`.sh` composes a draft and shells out to the real
`swarm_handoff.sh` with it — the same path a hand-written draft takes.
Every send-time gate still arms, the tmux wake still fires, and a refusal
is the gate's own text passed through unchanged; the composer adds no
verdict of its own. `ceremony_handoff_lib.bb` (the composition logic) is
pure — it never touches the filesystem or sends anything; only the CLI
around it writes the draft (to worktree-local `tmp/ceremony-handoff.txt`,
never `/tmp`) and invokes `swarm_handoff.sh`.

## Never truncates

The message is built from `message-forms` tried longest-prose first. If the
longest form doesn't fit the 80-character cap, a shorter prose form is
tried — the ticket id and the commit are the two facts the recipient acts
on, so neither is ever truncated to make room. If even the shortest form
doesn't fit, composition fails outright rather than cutting anything, and
the ceremony is sent as an ordinary note instead.

## The recipient list has one definition

`handoff-protocol.md` documents the `bookkeep` recipient list and
priority; a test parses that document and asserts
`ceremony_handoff_lib.bb`'s `ceremonies` map agrees with it, rather than
restating the claim as a comment that could drift (BL-897). `spec-ready`
isn't defined in the protocol document, so only `bookkeep` is pinned this
way.

## Out of scope

The commit half of "commit and hand off" — `ceremony_handoff.sh` composes
and sends only; staging changes on an agent's behalf is a separate slice
(BL-667's remaining `commit --only <declared paths>` work). Updating role
prompts to make this the standard route is the specifier's to land, not
part of this build.

Acceptance: `specs/features/BL-1360-a-ceremony-handoff-is-composed-not-retyped.feature`.
