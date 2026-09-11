# BL-1535 specifier evidence: the chase displaced a working resident three times on 2026-09-11

- **Trigger**: coordinator note 2026-09-11 06:40:55Z, "rotation hop stranded
  unsent handoff.txt 2x today - mint-worthy?", preceded by its 06:25:14Z
  note "rotate_to_role.sh hardender - unsent git_handoff to documenter
  stranded" (the previous specifier session rotated the resident back;
  rotation log 06:30:37Z, hardender forwarded at 06:31:19Z).
- **Sources**: `.swarmforge/telemetry/rotation-2026-09.jsonl`,
  `.swarmforge/telemetry/*.jsonl` chase rows, `git log` of
  `swarmforge-hardender`, `.worktrees/hardender/tmp/`, the mono-router
  code paths named below. Times are UTC; the host clock is BST (UTC+1).

## Timeline (rotation log, reason column verbatim)

| at (Z) | rotation | what the daemon was doing |
|---|---|---|
| 05:26:57 | coder -> hardender, `rotate` | chase row `specifier count 3` at 05:26:57.594 for the coordinator note `00_20260911T042556Z_007787` (enqueued 04:25:56Z, aged) |
| 05:29:58 | hardender -> specifier, `rotate` | chase row `specifier count 4` at 05:29:58.321 - the resident had been hardender for 3 minutes |
| 06:00:15 | specifier -> coder, `handoff-forward` | |
| 06:09:04 | coder -> hardender, `handoff-forward` | hardender resumes |
| 06:15:28 | (nudge) | daemon nudges BOTH hardender in_process parcels (`00_20260911T052454Z` from architect, `00_20260911T040854Z` from QA) as stalled, 6 minutes in |
| 06:17:07 | hardender -> specifier, `rotate` | chase row `specifier count 1` at 06:17:06.674 for the coordinator note `00_20260911T060534Z_007798` (enqueued 06:05:34Z, aged 11.5 min); hardender's git_handoff draft to documenter left on disk, unsent |
| 06:25:14 | | coordinator finds the unsent draft, notes the specifier to run `rotate_to_role.sh hardender` |
| 06:30:37 | specifier -> hardender, `handoff-forward` | |
| 06:31:19 | hardender -> coder, `handoff-forward` | the stranded draft is sent within a minute |
| 07:05:00 | QA -> coder, `handoff-forward` | QA bounces BL-1518-a to the hardener (2 defects) |
| 07:06:59 | coder -> hardender, `rotate` | hardender picks up `batch_20260911T070708Z_000001` (in_process now) |
| 07:07 | | `378169ed91 Merge QA d8704979b4 into hardender.`; mutation rerun starts (`.worktrees/hardender/tmp/bl1518a-mutation-rerun.log`, detached: `[detach_job]`) |
| 07:09:38 | hardender -> specifier, `rotate` | chase for the coordinator's 06:40:55Z note (aged 28 min); the hardender pane is killed 2.5 minutes into the rework |
| 07:23:05 | | the orphaned mutation run finishes (`Done in 14 minutes and 46 seconds`, `[detach_job] EXIT=0`) into a worktree whose role no longer exists; its result is read by nobody |

Three displacements in one shift: 05:29:58Z, 06:17:07Z, 07:09:38Z. Each
took the resident away from a role holding a real `inbox/in_process`
parcel. One needed a coordinator hand-rotation (06:25Z); one wasted a
15-minute mutation run and will make the hardener redo it; the 05:29Z one
cost a 40-minute round trip before the hardender was seated again.

## Why the daemon does this

`handoffd.bb` `attempt-resident-rotate!` (line ~1646) gates the chase
rotation through `mono-router-lib/should-rotate-resident?` (line 483) with
these inputs only: `:resident-busy?` = `resident-pane-busy?` =
`chase-sweep-lib/actively-processing?` on the captured pane tail (a
live-status footer frame), `:ignore-busy?` (ambulance), `:already-active`
(BL-921 live identity) and the rotate cooldown. Nothing consults the
departing role's `inbox/in_process` box - the exact input BL-805 (2026-08)
gave the RESIDENT-INVOKED path (`respawn-as!` ->
`departing-role-blocking-handoff` -> `rotate-gate-decision`). The
`rotate-gate-decision` docstring records the choice: "The daemon's own
rotate-resident-to! call (handoffd.bb chase) never routes through this -
gating it would risk deadlocking chase-driven drain ... (invariant: daemon
rotation always fails open)".

A role whose turn is inside a detached command (the 07:09Z mutation run,
`[detach_job]`), or which has written its draft and stands between the two
`swarm_handoff.sh` calls of the self-audit (06:17Z: draft on disk, a
standing challenge under `.swarmforge/handoffs/audit_pending/<sha(sender)>/`),
shows an idle footer. To the gate it is indistinguishable from the idle
holder the 2026-08-31 seated-preferred hotfix deliberately yields (a QA
seat holding a parcel under an Article 4.2 hold while a specifier note
waits) - and so it is rotated away.

The held parcel stays actionable (`role-mail-row` counts `in_process` as
`held`), so the chase eventually brings the role back: the loss is the
interrupted work, the orphaned run, and the wait.
