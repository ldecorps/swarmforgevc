# Coder unowned-red note on test_branch_claim_guard.sh - specifier adjudication (2026-09-16 21:45Z)

Inbound: `00_20260916T212946Z_002011_from_coder_to_specifier_coordinator`,
"unowned-red: test_branch_claim_guard.sh scenario 01 stderr warning,
pre-existing". No coder evidence file names the test; the coder held no
parcel when the note was read (BL-1606 had landed, e8a58b386d). Outcome:
**BL-1613** minted; one register row (lane shell).

## Reproduction on main (40b28c4219, 21:35Z)

`bash swarmforge/scripts/test/test_branch_claim_guard.sh` -> exit 1:

```
PASS: baseline: empty inbox on a ticket branch prints NO_TASK and never fires the guard
FAIL: 01(swarmforge-coder): a passing guard emits no warning, got: backlog_depth_lib: no swarm-identity for /tmp/tmp.p6mjnCofJ3 - falling back to the tracked default conf /tmp/tmp.p6mjnCofJ3/swarmforge/swarmforge.conf
```

## Mechanism (read, not guessed)

- Fixture (lines 30-46) writes `.swarmforge/swarm-identity` with
  `swarm_name` and `swarm_mode` only.
- `backlog_depth_lib.bb:140-165` `conf-file-path` (BL-966, 5c8b0835f8,
  2026-08-20) reads `active_backlog_max_depth_conf_path`; absent -> the
  stderr line above, by design ("never silent").
- `ready_for_next_task.bb` claim path reads `pack-conf (mono-router-conf-text)`
  = `(slurp (backlog-depth-lib/conf-file-path (target-root)))` on every
  claim since BL-1004 (19b28a1a84, 2026-08-21).
- Line 107: `[[ -z "$ERR" ]] || fail "01(swarmforge-coder): a passing guard emits no warning ..."`.
  Red since 2026-08-21; 27 days; first recorded today. BL-1530's
  2026-09-11 shell census covered the tests that drive swarm_handoff,
  not this one.

## Census (BL-1445)

Shell tests writing a swarm-identity: 31. Without the conf-path key AND
driving the claim path: 5 (test_branch_claim_guard,
test_worktree_drift_guard, test_worktree_drift_guard_master_resident_exempt,
test_supersede_guard, test_reference_freshness_guard). Asserting an
empty stderr around a claim: 1 (this file). So one red for this reason;
the other four print the fallback and ignore it. Pinned as BL-1613
scenario 03.

## Outcome

- BL-1613: fixture gains the key and the tracked conf; assertion kept.
- Register: `shell` row for the file, owner BL-1613, first_seen
  2026-09-16. Register 3 -> 4 rows, all owned.
- Notes: coordinator (paused-ready), coder (owner ack).

## Recorded, not ticketed

- Nothing runs the shell tests as a lane, so a fixture-schema change can
  turn a test red for a month unseen (same finding as the acceptance
  corpus today, BL-1602/BL-1608). Ceremony-packet material: a shell-lane
  census run, like BL-1530's, on a schedule.
