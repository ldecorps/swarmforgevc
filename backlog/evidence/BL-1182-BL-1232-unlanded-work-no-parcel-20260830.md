# BL-1182 and BL-1232 — RETRACTED: there is no dispatch gap — 2026-08-30

**This file's original finding was WRONG and is retracted in full. Both tickets
are live and in flight.** The retraction and its cause are kept here rather than
deleted, because a note carrying the wrong finding was already sent to the
coordinator and the correction has to be walkable from the same place.

## What was claimed, and why it was wrong

Prompted by QA's priority-00 note ("BL-1284 landed tip-pure (BL-1241) - coder
branch entangled with BL-1182+BL-1232"), the specifier reported that BL-1182 and
BL-1232 had committed work on `swarmforge-coder`, no live parcel anywhere, and an
idle pipeline — a dispatch gap for the coordinator to close.

**The "no live parcel" half was a measurement error.** The mailbox sweep was run
against `.worktrees/<role>/.swarmforge/handoffs/<role>/inbox/<state>`. The
worktree roles do not use that shape. Per `handoff_lib.bb`'s own comment at
`mailbox-base-dir` — "Roles with their own dedicated worktree already have
physical separation and keep their existing flat layout; only worktree-name
`master` gets the extra `<role>` subdirectory" — the six pipeline roles are
**flat**: `.worktrees/<role>/.swarmforge/handoffs/inbox/<state>`. Every probe hit
a path that does not exist and returned zero, so an active pipeline read as an
empty one.

## The actual state, re-measured against the correct paths

| Ticket | Where it actually is | Parcel |
|---|---|---|
| BL-1182 day-long BoB trial lifecycle | **hardender**, in_process (batch `batch_20260830T024219Z_000001`) | `git_handoff` commit `604a245de3` |
| BL-1232 shift-velocity chart readable | **QA**, in_process | `git_handoff` commit `e373a940fa` from documenter |

Also live at the same moment: BL-604 at the architect (`7c05b99402`), BL-1243 and
BL-1235 routed to the coder. The pipeline was busy throughout.

`.swarmforge/board/ticket-stage-map.json` read
`{"BL-1182":"hardender","BL-1232":"QA", ...}` and was **correct**. It was briefly
suspected of being stale on the strength of the bad sweep; it was not.

## What survives from the original investigation

Only the ancestry facts, which were measured correctly and remain true — and which
are unremarkable once the parcels are located:

- `f64ad3280` (BL-1182) and `9c6200d72` (BL-1232) are not ancestors of `main`.
  That is what unlanded in-flight work looks like; both have since been carried
  forward under new commits by later stages.
- BL-1284's abandoned tip `fa7d305367` is benign: the landed `a4d43634e` carries
  identical content.
- BL-1273's stranded `205fdd36f` has since landed and is now an ancestor of `main`,
  so that earlier instance is closed.

## Lesson

A mailbox sweep must use `handoff_lib.bb`'s resolver, or at minimum both layout
shapes — master-resident roles nest under `<role>/`, worktree roles do not. A
sweep that silently finds no directory must report NO DIR, never zero; the
original sweep's `[ -d "$d" ] || continue` turned six missing paths into six
confident zeroes. Absence of a directory is not absence of work.

By specifier.
