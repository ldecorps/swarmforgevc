# BL-651 — live reproduce ×2 on 2026-08-01 (JumpQ evidence for specifier)

Human (Let's Talk, evening 2026-08-01): queue-jump BL-651 and tell the
specifier this starve happened **twice today**. Not a regression of today's
lands (BL-760/720/771); same structural gap filed 2026-07-25.

## Occurrence 1 — afternoon idle (≈15:30–17:00 BST)

- Active ticket: BL-663 (promotion-gates chokepoint), mid-pipeline.
- Main HEAD stuck at `67d2741ef` (15:09 Spec BL-663) for hours.
- Babysitter: repeating `CRIT [proc-coder|proc-coordinator] pane alive but NO
  claude process under it (half-launch/exit)` then `NUDGE-SKIP` — so it never
  nudged the coordinator.
- False positive: pane shell is `sh` → child `zsh` launch script → grandchild
  `claude`. Babysitter only `ps --ppid` one level deep.
- Operator sweeps stayed "GREEN / idle-correct" and took no action.

## Occurrence 2 — evening dormant documenter (from 17:04 BST)

- Hardener merged BL-663 bounce fix (`a1aa59406`) and enqueued
  `00_20260801T160451Z_000512_from_hardender_to_documenter_for_documenter.handoff`
  into `.worktrees/documenter/.../inbox/new/` at 2026-08-01T16:04:51Z
  (17:04 BST). Task: BL-663.
- At observation ~18:06 BST the parcel was still in `new/` (~60+ min), no
  documenter seat live (mono-router 2-pack = coder + coordinator only).
- Coder Claude live on the worker seat but not rotated to documenter.
- Babysitter check #10 (swarm-starved) did **not** fire: `pend>0` because that
  dormant-queue parcel counts as motion.
- Operator 16:46Z: claimed inboxes empty and "dormant downstream seats,
  mono-router" as idle-correct — missed the worktree documenter `new/`.

## Specifier ask

Keep BL-651's shape (aged git_handoff in dormant queue beats idle home).
Add today's fixtures alongside the 2026-07-25 cleaner-broadcast fixture:

1. Hardener→documenter git_handoff ages in documenter `new/` while resident
   is idle at coder home → must rotate to documenter before flow-watchdog WARN.
2. Observers must not suppress: pending mail to a **windowless** role is not
   "motion" for starve detection (companion gap; may stay out of scope here
   if BL-650/babysitter tickets own it — call it out either way).

Do not invent severity inflation; ticket stays `type: feature` /
`direction: queue-jump` / `priority: 0` per human JumpQ, not Article 3.2.4.
