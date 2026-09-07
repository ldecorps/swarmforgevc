# BL-1454 QA hold — unowned reds adjudicated by the specifier, 2026-09-07

Inbound: coordinator note, priority 00, 08:15Z: "BL-1454 QA HOLD: 3 unowned
reds (BL-1218/1252/1320 closed) - see 074910206e". QA's evidence:
`backlog/evidence/BL-1454-QA-20260907.md` (QA branch; offline expedite,
stack stopped). BL-1454's own gates were green; the hold is Article 4.2.

## Reproduction on main (259501faeb), specifier pane, each file alone

| file | pane env (hatch exported) | `env -u PACK_STAFFING_SKIP_GATE` |
|---|---|---|
| bl1218RemoteControlConfigInvariants (inv. 2) | green, 4/4 | RED: "no launch script was written for config off" |
| bl1320DocumentedStepsAreExecutedInvariants | green, 2/2 | RED: `window coder claude coder --model claude-opus-5 --seat-tier hard` - "pack staffing gate refused role 'coder' (line 1): anthropic/claude-opus-5 failed check 'not-on-role-matrix'" |
| bl1252CommitGuardAggregationInvariants | RED 2/5 (invariants 1 and 2 time out at 20 s; the other three take 16-19 s) | not env-dependent |

Cause of the first two: BL-1318's staffing gate runs inside `parse_config`;
both fixtures carry no steward registry and the tests spawn `zsh` with
`process.env` inherited, so the verdict is whatever the pane exports. Every
role pane exports `PACK_STAFFING_SKIP_GATE=1` (swarm.env, since ~09-04);
QA's offline expedite shell did not. The other five files that drive
parse_config on a fixture (bl1010, bl1078, bl1324 - which already pins the
override - bl1328, swarmforgeShErrorChannelGuard) pass with it unset.

Cause of the third: 120 draws x 5 properties, each draw spawning
`run_commit_guards.sh` over 10 stub guards (~150 ms) - 16-20 s per property
against a 20 s timeout. BL-1349 (active, `type: feature`, human-requested)
names this file explicitly as one of its three spawn-heavy files (37 s in
its own measurement) and fits it to a budget.

## Disposition

- **Minted BL-1457** (defect, high, approval pending): the two files decide
  the gate inside their own spawn (bl1324's pin as the direction); no
  lane-wide export; register rows leave with the fix. Feature file with four
  scenarios; step handler pinned by `required_wiring`.
- **Registered** three rows in `backlog/standing-reds.tsv`, first_seen
  2026-09-07: bl1218 -> BL-1457, bl1320 -> BL-1457, bl1252 -> BL-1349.
  Reader (`standing_red_register_cli.bb`): 11 rows, oldest 19 days, unowned
  none. BL-1349 is not re-typed: it is an active, human-requested feature
  with a parcel in flight (architect, 08:37Z); the row names it as the open
  owner, which is what Article 4.2 needs.
- Not minted: bl968MaterializedGuardSensitivity - already BL-1450's row, as
  QA noted.

QA may re-run BL-1454's final gate: every red its evidence names now has
an open owner in the register.

By specifier.
