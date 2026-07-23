# BL-548 promoted with its own promotion_blockers unmet

**Stage:** coder · **Date:** 2026-07-23 · **Ticket:** BL-548 (backlog/active/)

## Finding

BL-548's own `promotion_blockers` field requires BL-546 Slice 2 (adapters +
`SWARMFORGE_PROMPT_EXPERIMENT` isolation) AND BL-547 Slice 2 (`model-steward
evaluate`) to be landed on `main` before this ticket may be promoted — "not
merely those tickets done at Slice 1."

Checked `main` (post-merge in this worktree, commit range up to `115d7e213`):

- `swarmforge/scripts/model_steward_cli.bb` dispatches only
  `status/show/register/certify/decertify/role-matrix/capability/adapter/eligible`
  — no `evaluate` subcommand. `model_steward_lib.bb:146` itself says "that is
  Slice 2's `evaluate`" as a forward reference, not yet built.
- `grep -r SWARMFORGE_PROMPT_EXPERIMENT swarmforge/ extension/` returns zero
  matches anywhere in the repo — the experiment-isolation env contract BL-548
  is "Firm" about does not exist.
- `backlog/done/BL-546-...yaml` and `backlog/done/BL-547-...yaml` both show
  only Slice 1 delivered (Slice 2/3 scenarios remain parked in
  `*.feature.draft` files per their own specs).

## Why this matters

BL-548 Slice 1 acceptance requires composing experimental adapter variants
(BL-546 S2) and invoking `model-steward evaluate` per variant (BL-547 S2).
Neither exists. Implementing them here would be doing BL-546/BL-547 Slice 2
work under BL-548's ticket — out of BL-548's own declared scope — not a
legitimate Slice 1 for this ticket.

## Requested action

Hold BL-548 back to `backlog/paused/` (or leave active but do not route further
work on it to coder) until BL-546 Slice 2 and BL-547 Slice 2 land on `main`.
No code changes made under this ticket.
