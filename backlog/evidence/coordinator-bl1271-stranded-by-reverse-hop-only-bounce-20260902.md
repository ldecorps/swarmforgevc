# BL-1271 stranded: QA bounce delivered ONLY as a reverse-hop copy — 2026-09-02 ~17:40 UTC

## How it surfaced
`pipeline_stage_cli.bb sync` showed BL-1271 as `stage: coordinator,
status: last-known, asOf 14:51` — but no BL-1271 parcel exists in any
mailbox (coordinator `new`/`in_process`, every worktree `new`/`in_process`).

## What actually happened (all from durable files, not inference)
- 17:17 UTC QA merged documenter's BL-1271 (`1056f9e666`), reviewed, and
  BOUNCED it: `991ec6ead8` "QA bounce evidence — invariant 2 violated by
  cleaner dedup consolidation"; `4cb5c33551` recorded
  `bounce_history: {by: QA, blamed: cleaner, class: behavior, commit: 991ec6ead8,
  evidence: backlog/evidence/BL-1271-qa-bounce-20260902.md}`.
- 17:19 QA's ONLY outbound artifact for BL-1271 was
  `00_20260902T171934Z_002127_from_QA_to_cleaner.handoff`: `type: git_handoff`,
  `commit: 991ec6ead8`, **`non-forwarding: true`**. QA's `sent/` holds
  zero BL-1271 `note`s.
- 17:19–17:20 cleaner dequeued it, merged (`9778f7272b "Merge QA 991ec6ead8
  (reverse hop) for BL-1271"`), and ran `done_with_current.sh` — exactly
  what Article 2.4 prescribes for a `non-forwarding: true` inbound
  ("merge-only ... Do not send a git_handoff for that inbound").
- Now: QA pane idle (`NO_TASK`), cleaner pane idle ("No task available"),
  no BL-1271 parcel anywhere. Ticket still `backlog/active/`, `status: todo`.

**Cleaner did nothing wrong.** The bounce's rework ORDER never existed as
actionable work: a reverse-hop copy is a tree-sync mechanism, and the
protocol says it is terminal for the receiver. Nothing told cleaner "you
own this fix; rework and forward."

## Protocol gap (for the specifier — currently unstaffed, see
[[coordinator-specifier-outage-recurred-blocking-hotfix-stamp-20260902-1733]])
Article 4.3 routes a bounce to the owning role; Article 2.4 makes a
`non-forwarding: true` inbound merge-only. When QA's bounce to the owning
role is ONLY the `non-forwarding` copy (no forward `git_handoff`, no
`note`), the two rules compose into a silent drop: the receiver correctly
stops, and the ticket is held by no one. QA prompt's bounce contract should
require an actionable forward artifact (a `note` at minimum) to the
blamed role, alongside/instead of the reverse copy. Worth a ticket once a
specifier exists to mint it; this is BL-1341-adjacent (silent drops that
nothing reports).

## Minimal correct action taken
- Sent cleaner a `note` (priority `00`): rework the QA bounce
  `991ec6ead8` (dedup invariant 2) and forward normally. Cleaner already
  has the bounce tree merged (`9778f7272b`) and the evidence file in-tree.
- Re-ran `pipeline_stage_cli.bb sync` after sending so the board stops
  showing BL-1271 at the coordinator.
- Not re-routing to coder or anyone else: `bounce_history` says
  `blamed: cleaner`; ownership drives routing (Article 4.3).

By coordinator.
