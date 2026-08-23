# Operator directive — Cursor seats then sleep; local-LLM is human work

**From:** human via Cursor, 2026-08-23 ~02:24 BST  
**Priority:** 00

## Goal

Tomorrow the human wants **Cursor in the coder and QA seats**. Keep the
swarm working the Cursor seat chain overnight. **Sleep (finish-shift) only
after that chain has landed.**

## Required landings (then sleep)

| Ticket | Why |
|--------|-----|
| BL-1078 | launcher accepts `cursor` agent token |
| BL-1079 | steward certify (blocked on 1078; promote when 1078 done) |
| BL-1080 | pack can name cursor on a window line |
| BL-1081 | ACP-host pane control channel |

Watcher: `.swarmforge/operator/sleep-when-cursor-landed.sh` → `./finish-shift`
when all four are in `backlog/done/`.

## BL-1082 / BL-1052 / BL-1053 — DO NOT TOUCH

Parked on purpose. The human will implement this local-LLM chain **themselves
in Cursor** after the seat chain lands. Swarm must **not** promote, dispatch,
or spec-amend these tickets unless the human says otherwise.

Order the human plans: **1082 → 1052 → 1053**.

## Do now

1. Land BL-1078 → promote BL-1079 → BL-1080; BL-1081 in parallel OK.
2. Never promote 1082/1052/1053 ahead of (or instead of) that chain.
3. No early Sunday finish-shift.

---

## Specifier disposition — 2026-08-23

Drained from the backlog root. **Nothing new to mint:** every ticket this
directive names already exists and is `human_approval: approved`.

| Ticket | Folder at drain time | priority | assigned_to | depends_on |
|---|---|---|---|---|
| BL-1078 | `active/` | 0 | coder | (none) |
| BL-1079 | `paused/` | 1 | specifier | BL-1078 |
| BL-1080 | `active/` | 2 | specifier | BL-1079 |
| BL-1081 | `active/` | 3 | coder | (none) |

The directive's substance is **promotion order and shift timing**, which are
coordinator duties, not specification. It is therefore recorded as a standing
directive in `backlog/STEERING.md` (specifier-owned, the sanctioned home for a
human pull-order constraint) rather than converted into a ticket, and the
coordinator is notified.

Two observations passed to the coordinator, not acted on here (routing is not
the specifier's call):

- BL-1079 and BL-1080 both read `assigned_to: specifier`, while their work is
  implementation. BL-1080 sits in `active/` with that assignee.
- BL-1080 declares `depends_on: [BL-1079]`, so the chain is strictly serial
  1078 → 1079 → 1080; only BL-1081 can run in parallel, exactly as the
  directive says.

The `.swarmforge/operator/INTAKE-cursor-seats-then-sleep.md` copy was archived
to `.swarmforge/operator/archive/` in the same pass (BL-311).
