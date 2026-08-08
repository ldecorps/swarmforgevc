# A role's answer (and a steer) now reaches the rotating resident's pane

Under mono-router, `resolveRolePaneTarget` — the one function both role-answer
delivery (BL-607) and Telegram role-topic steering (BL-425) use to find a
role's live tmux pane — read the `session` column of `.swarmforge/roles.tsv`.
That file names a session for all eight pipeline roles, but a mono-router
swarm only ever has two live tmux sessions: the resident pane
(`swarmforge-coder`) and `swarmforge-coordinator`. So for any rotating role —
even the one the resident is *currently running as* — the live-pane leg could
never resolve, and delivery silently fell through to the role's mailbox.

That is fine for a dormant role: the note sits in its inbox until its next
rotation. It became a deadlock for exactly one case: the role is the active
resident **and** is holding in-process work. `ready_for_next.sh` forbids that
role from re-checking its own mailbox until the in-process parcel is done, so
an answer already delivered to the one place the role could look was
structurally unreachable. That is what happened on 2026-08-07 (see
`docs/how-to/BL-773-coordinator-role-ask-clarifying-question.md`'s "What this
does not fix" section, written before this fix landed).

## The fix

`resolveRolePaneTarget` now consults `.swarmforge/mono-router-active-role` —
the durable marker rotation already writes on every hop
(`write-mono-router-active-role!` in `swarmforge/scripts/handoff_lib.bb`).
When the requested role is the role the marker currently names, resolution
returns the **resident's own session entry** (the first non-coordinator row
in `roles.tsv`) instead of that role's own never-created session. Every other
role, and every missing/blank marker, resolves exactly as before — including
on a full (non-mono-router) pack, where the marker file never exists.

This is resolution only: no new delivery path, no change to the in-process
guard, no change to answer-capture or marker-clearing semantics.

## What this means in practice

- **Role answers** (`role_ask.bb`): an answer for whichever role the resident
  is currently rotated into is now delivered as an interrupting pane nudge,
  even while that role holds in-process work — it no longer waits behind a
  mailbox the role cannot read. An answer for a role the resident is *not*
  currently running as still queues as a note, unchanged.
- **Telegram role-topic steering** (BL-425,
  `docs/how-to/BL-566-steer-a-role-from-telegram.md`): steering a role's own
  topic now also succeeds whenever the resident is currently rotated into
  that role — not only when the role is `coordinator` or `coder` sitting at
  home. Check the Swarm Live Screen (or the resident-identity marker) to see
  which role is currently steerable this way.

## What this does not fix

- A note that is **not** the answer a blocked role is waiting on still waits
  for that role's in-process parcel to finish, same as before — only the
  answer a role is actually blocked on gets the interrupting delivery.
- The in-process guard, `ready_for_next.sh`, and role prompts are unchanged.
- An undeliverable outbound *question* (the ask leg wedging) is a separate,
  already-tracked gap (GH-26).
