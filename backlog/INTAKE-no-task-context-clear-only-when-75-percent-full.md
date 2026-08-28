# INTAKE — NO_TASK idle-clear only when context is ≥75% full

**Source:** human via Cursor, 2026-08-28 ~07:34 BST  
**Status:** new intake, not minted  
**Surface:** worker idle-clear / context reload on `NO_TASK`  
(`ready_for_next_task.bb` / `ready_for_next_batch.bb` → `respawn-self!`)

## Locked human decision

Workers **may** clear their context window when they hit `NO_TASK` **only if**
their current context is **at least 75% full**.

**Intent (verbatim):** do **not** pay for a reload when it is not needed.

## Why this is in front of you

BL-141 already shipped the 75% fullness gate for the **extension-host**
idle-clear path (`extension/src/swarm/idleClear.ts` /
`contextFullness.ts`; Spec § Per-role idle context clearing;
`swarmforge.contextClear.fullnessThresholdPercent` default 75%).

The **agent-side** path that actually burns a reload today does **not**
honor that gate:

- `ready_for_next_task.bb` / `ready_for_next_batch.bb`
  `maybe-clear-at-idle-boundary!` — when `idle-clear` is enabled and the
  call is `--idle-boundary` + `NO_TASK`, it always calls
  `handoff-lib/respawn-self!`.
- That respawn re-execs the launch script and re-pays the boot prefix /
  model reload even when the pane still has most of its window free.

So the cost the human wants to avoid is still paid on the mailbox idle
path that roles actually take after `done_with_current`.

## Goal

Mint a ticket (or amend the live idle-clear owner if the specifier prefers)
so that on `NO_TASK` at an idle boundary:

1. If context fullness **&lt; 75%** → **do not** clear / do not
   `respawn-self!` (role stays in the current session).
2. If context fullness **≥ 75%** → clear/respawn is allowed (existing
   idle-clear opt-in and safety gates still apply).
3. Prefer the same fullness source contract as BL-141 (telemetry when
   available, labeled proxy otherwise) so extension and bb paths do not
   disagree on the number.

## Out of scope

- Changing the default 75% threshold (already the Spec/BL-141 default).
- Forcing idle-clear on for roles that do not opt in (`idle-clear` on the
  window / roles.tsv column stays opt-in).
- Mid-task / mid-batch clears (still forbidden).

## Pointers

- Done precedent: `backlog/done/M4-governance-backlog-sync/BL-141-context-clear-only-when-window-mostly-full.yaml`
- Opt-in flag: BL-089 / `handoff-lib/idle-clear-enabled?`
- Gap call sites: `swarmforge/scripts/ready_for_next_task.bb`,
  `swarmforge/scripts/ready_for_next_batch.bb` (`maybe-clear-at-idle-boundary!`)
- Extension path that already gates: `extension/src/swarm/idleClear.ts`
- Spec: `docs/reference/Specification.MD` § Per-role idle context clearing
