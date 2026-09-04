# Composing a fixed pipeline ceremony instead of hand-typing it (BL-1360)

## What it is

Three pipeline sends carry no judgement at all — only a ticket id and (for
two of them) an approved commit vary, everything else is already fixed by
`swarmforge/handoff-protocol.md`:

- **`merge-up`** — QA's broadcast telling every worktree role
  (`coder,cleaner,architect,hardender,documenter`) to merge up to the
  approved commit, priority `00`.
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

## Usage

```
swarmforge/scripts/ceremony_handoff.sh <ceremony> --ticket BL-042 [--commit a1b2c3d4e5] [--dry-run]
```

`<ceremony>` is one of `merge-up`, `bookkeep`, `spec-ready`. `merge-up` and
`bookkeep` need both `--ticket` and `--commit`; `spec-ready` needs only
`--ticket`. `--dry-run` prints the composed draft and sends nothing —
useful for checking the composition once instead of re-deriving it every
time.

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

`handoff-protocol.md` documents the `merge-up` and `bookkeep` recipient
lists and priorities; a test parses that document and asserts
`ceremony_handoff_lib.bb`'s `ceremonies` map agrees with it, rather than
restating the claim as a comment that could drift (BL-897). `spec-ready`
isn't defined in the protocol document, so only the two the document does
define are pinned this way.

## Out of scope

The commit half of "commit and hand off" — `ceremony_handoff.sh` composes
and sends only; staging changes on an agent's behalf is a separate slice
(BL-667's remaining `commit --only <declared paths>` work). Whether the
merge-up broadcast should exist at all (BL-668's sweep did not eliminate
it — see `docs/how-to/BL-1241-entangled-tip-at-the-land-step-has-a-reachable-remedy.md`
and related BL-668 tickets). Updating role prompts to make this the
standard route is the specifier's to land, not part of this build.

Acceptance: `specs/features/BL-1360-a-ceremony-handoff-is-composed-not-retyped.feature`.
