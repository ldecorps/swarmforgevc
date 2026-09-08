# Two unowned reds adjudicated by the specifier, 2026-09-08: BL-1476's deferred mutation row (BL-1488) and the deleted swarm profiles (BL-1487)

## BL-1488 - the BL-1476 hardening-debt row

Inbound: coordinator note, priority 00, 03:49:50Z: "BL-1476 closed with
unowned hardening-debt row - mint owner (BL-1468 pattern)".

Verified on main `0f46d27908`:

- `backlog/hardening-debt-ledger.yaml`: `parcel: BL-1476, gate: mutation,
  file_set: transcriptWalker.ts, turnProfileProducer.ts,
  run-turn-profile-producer.ts, detected_at 2026-09-08`, reason
  "mutation_cooldown_gate.bb: skip-cooldown ... 2.95-2.97 of 3 days (all
  last touched on main by BL-1364, 2026-09-05)"; transcriptSummaryStore.ts
  exempt and mutation-tested in the pass.
- BL-1476 landed `f0f54791c5` (2026-09-08T02:56Z, hand-built tip-pure
  replay; touches all three files) and is in `backlog/done/`.
- `bb swarmforge/scripts/standing_red_register_cli.bb .`: 24 rows, exactly
  one UNOWNED: `{lane hardening, file <the three>, ticket BL-1476,
  first_seen 2026-09-08}`.
- `mutation_cooldown_gate.bb` on each file: `file_age_days: 0.05 (cooldown:
  3 days)`, host quiet (2.66/20). Earliest run 2026-09-11.
- BL-1441 (active) and BL-1468 (paused, not_before 2026-09-10) own other
  rows and are not widened.

Disposition: **BL-1488** minted (defect, high, approval pending,
`not_before: 2026-09-11` for BL-1469's gate), BL-1468's shape; `hardening`
register row -> BL-1488, first_seen 2026-09-08.

## BL-1487 - the deleted `swarmforge/profiles/`

Inbound: the previous specifier session's sweep
(`acceptance-lane-sweep-unowned-reds-adjudication-specifier-20260908.md`)
planned BL-1487 for three reds and was killed by the 03:21:16Z supervisor
halt before minting it; its successor landed BL-1486/BL-1489 but not this.
The reds stood unregistered.

Verified on main `0f46d27908`: `swarmforge/profiles/` absent (deleted by
`4695d31402`, 2026-08-23, "chore: finish junk artifact removal after swarm
cleanup", no ticket); 26 tracked files still name it, of which outside
backlog history: `.vscode/launch.json` (two launch configs),
`swarmforge.sh:1284-1286` (sync guarded by `-d`), `reset_worktrees.sh:107`,
`sync_worktree_scripts_lib.bb:10`, `smoke_check_stabilize_two_pack.sh`,
`daemonWorkflowSteps.js:22` (`REAL_PROFILE`), the BL-939 and BL-373
features, two shell tests, one property test, the BL-203 how-to.
`swarmforge/packs/` holds 20 live packs. The smoke shell test's case 01 is
red for a second, independent reason (its fixture declares a coordinator
window, rejected since BL-243).

Disposition: **BL-1487** minted (defect, high, approval pending with
`ruling_options` restore/retire, retire recommended); register rows:
acceptance BL-939 feature (first_seen 2026-08-23), shell
test_shipped_confs_no_coordinator_window.sh (2026-08-23), shell
test_smoke_check_stabilize_two_pack.sh (2026-08-19).

Epic BL-541 `decomposes_into` extended with BL-1468, BL-1486, BL-1487,
BL-1488 (the first two were minted without the tracker line).

By specifier.
