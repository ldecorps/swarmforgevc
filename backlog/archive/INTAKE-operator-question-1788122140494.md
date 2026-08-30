# Intake: a question the Operator could not answer

Filed by the Operator (2026-08-30T20:35:40.495064719Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

Human directive to the coordinator: augment (increase) the swarm's throughput — raise dispatch concurrency / WIP so more tickets progress in parallel. Coordinator to decide and apply the throughput increase within safe limits.

---

## Specifier disposition (2026-08-30, drained)

**Not converted into a ticket.** The directive's substance is **WIP / dispatch
concurrency**, which is a coordinator duty (Article 3.2.1 promotion cap;
STEERING "Pull policy"), not specification work. There is no code deliverable:
`active_backlog_max_depth` already accepts values above 1, and BL-1128 already
shipped `headroom_cap_raise_cli.bb` to raise it safely. Routing a conf value
through six pipeline stages would be over-scoping, and it would fail INVEST on
V and T — there is no observable behaviour change to gate.

Same disposition, and the same reasoning, as the 2026-08-23 "Cursor seats, then
sleep" intake archived beside this one: a human pull-order/WIP constraint is
recorded as a standing directive in `backlog/STEERING.md` (specifier-owned) and
the coordinator is notified.

**Recorded at:** `backlog/STEERING.md` §"Standing human directive (2026-08-30
~21:35 BST) — raise swarm throughput". The human's sentence is carried there
**verbatim** (Article 5.3 — a consolidation never drops a human sentence).

**Facts handed to the coordinator with it** (not decisions — the human
delegated the number to the coordinator explicitly):

1. The conf's `active_backlog_max_depth 1` carries an *earlier same-day* hold
   comment (`44d2d42591`, 17:03 BST, "reverse-hop + AUDIT_REQUIRED verification
   in flight"). This directive is ~21:35 BST and is the later operator word, so
   the hold is superseded.
2. That verification is nonetheless still open — BL-1299 (`severity: critical`,
   `status: todo`) sits in `paused/` with three recorded refusals.
3. BL-663, the 2026-08-01 review's compounding blocker (promotion script not
   enforcing ordering gates), is now in `backlog/done/M8/` — no longer a reason
   to hold the cap at 1.
4. Every stage is single-seat; no pack declares a duplicate `window` line. The
   cap pipelines stages but does not widen one, so a second seat may be the
   next lever if the cap alone does not satisfy "more tickets progress in
   parallel". That is a pack change and an operator decision.
5. Enabling BL-1128's five commented-out headroom keys is the smallest
   reversible way to honour the directive continuously.

No `role_ask` was raised: the directive is unambiguous, and the specifier's ask
slot is in any case held by the still-unanswered 2026-08-30 worktree-drift
question.
