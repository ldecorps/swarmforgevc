# BL-1529 / BL-1530 — specifier unowned-red census, 2026-09-11

Trigger: two coder `unowned-red` notes, 04:36Z, from the BL-1518 parcel:
`test_rule_proposal.sh 03b daemon did not drain the outbox` and
`test_handoff_state_dir_worktree_root.sh 01 audit blocks first send`.
Neither file had a row in `backlog/standing-reds.tsv`; neither matched an
open ticket (`grep -l -E 'test_rule_proposal|test_handoff_state_dir_worktree_root'
backlog/paused backlog/active` empty).

## Reproduction on `main` 4d019c0f91

- `test_rule_proposal.sh`: 01, 03, 03b, 02 PASS; **04 FAIL** on the
  `git_handoff` row — output is `TREE_COLLAPSE WARNING ... AUDIT_REQUIRED /
  HANDOFF_NOT_QUEUED / TASK_ID: bl-035-regress`. Two runs, 03b passed
  both; the coder's 03b sighting is the fixed 40 x 0.25 s outbox poll on
  a loaded host (same file, folded into the same row).
- `test_handoff_state_dir_worktree_root.sh`: **01 FAIL** — the single
  `swarm_handoff.bb` call from `$CODER_WT/extension` prints the challenge,
  `outbox_count` is 0.

## Cause

`44d2d42591` (2026-08-30, "Steal upstream reverse git_handoff hops and
two-call AUDIT_REQUIRED"): `submit-after-audit!` answers the first
invocation of a `git_handoff` draft fingerprint with `AUDIT_REQUIRED` /
`HANDOFF_NOT_QUEUED`, queues nothing, and `-main` returns nil → exit 0.
Both tests were last edited before that (08-25 / 08-21) and assert the
queue on the first call.

## Census (BL-1445): shell tests that invoke `swarm_handoff.(sh|bb)` and draft a `git_handoff`

```
for f in $(grep -l -E 'swarm_handoff\.(sh|bb)' swarmforge/scripts/test/test_*.sh); do
  grep -q 'type: git_handoff' "$f" && echo "$f"; done
```
11 files. Each run on `main` 4d019c0f91 (timeout 150 s):

| file | result |
|---|---|
| test_compliance_battery_cli.sh | green |
| test_required_stages_ticket_lookup_collision.sh | **red** — `no installed handoff file reported for task=BL-900-demo-task` (output is the challenge) |
| test_handoff_state_dir_worktree_root.sh | **red** — 01 |
| test_ticket_close_guard.sh | green |
| test_rule_proposal.sh | **red** — 04 |
| test_bl1494_deferred_note_no_wake.sh | green |
| test_swarm_handoff_inbound_non_forwarding_batch.sh | green |
| test_reroute.sh | **red** — exit 2 after 00: `ls -t outbox/*.handoff` finds nothing after `REROUTE: BL-900 ... CHECKPOINT:` |
| test_corrupt_handoff_never_dispatched.sh | green |
| test_redo_from.sh | **red** — exit 2 after 02: `ls "$OUTBOX"/*.handoff` finds nothing after `REDO: ... CHECKPOINT:` |
| test_swarm_handoff_inbound_non_forwarding.sh | green |

The two exit-2 files are not test defects. `bash -x` shows `redo_from.bb` /
`reroute.bb` succeeding, and `salvage_lib.bb` `queue-handoff!` (~142-168)
runs `swarm_handoff.sh` once, takes exit 0 as queued, and returns the
challenge text. `handoffd.bb` `auto-route!` (~2035-2050) has the same
one-call shape for the BL-222 dispatch-gap `git_handoff` and logs
`dispatch-gap-autoroute ... git_handoff` on exit 0. Non-test drafters of
`type: git_handoff` (`grep -l 'type: git_handoff' swarmforge/scripts/*.bb
swarmforge/scripts/*.sh`, 6 files): `salvage_lib.bb` (sender),
`chase_sweep_lib.bb` (draft; sender is handoffd's `auto-route!`),
`handoff_lib.bb` and `task_scope_gate_lib.bb` (comments), `swarm_handoff.bb`
(callee), `local_coder_battery.sh` (writes a draft, never sends).
`.swarmforge/handoffs/audit_pending/` holds only `.lock`; `run-log.jsonl`'s
last redo events are 2026-08-29; no `dispatch-gap-autoroute` log line since
08-30 — latent, not yet observed live.

## Disposition

- **BL-1529** (`defect`, `high`, epic swarm-reliability): script senders
  resubmit under the audit and fail loud on a challenge; owns the
  `test_redo_from.sh` and `test_reroute.sh` rows. Ruling posed on whether
  the challenge's exit code stays 0.
- **BL-1530** (`defect`, `high`, epic code-quality-gates): the three test
  files speak the two-call protocol, 03b bounded on delivery evidence;
  owns the other three rows. Both coder notes fold here.
- Five `shell` rows added to `backlog/standing-reds.tsv`, first_seen
  2026-08-30, in the mint commit.
