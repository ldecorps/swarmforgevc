# BL-1299 — hardener pass, 2026-08-30

Merged architect `78eb88e45b` (clean review, no findings).

## BL-113 gherkin mutation

`specs/features/BL-1299-reverse-hop-skips-master-resident-roles.feature` has
two `Scenario Outline`s.

- First pass (before the fix below): 16/16 mutants killed, 0 survived.
- After adding the discriminating Examples row (see below) and re-running
  `hard`: scenario 01 now carries 15 mutants (was 12), all killed; scenario 03
  unchanged at 4/4. 19/19 total, 0 survived. Manifest updated in-file.

## Hand-authored sweep of `reverse_hop_lib.bb` (no Stryker for Babashka)

Five hand-applied mutants against `reverse-recipients` / `master-worktree-names`
/ `coordinator-row?`, each verified via the unit + property runners:

| # | mutant | result |
|---|--------|--------|
| M1 | `back-one` branch replaced with `back-all`'s `(take idx roles)` | **SURVIVED** (real gap, closed below) |
| M2 | `back-all`'s `(take idx roles)` → `(take (inc idx) roles)` (off-by-one) | killed |
| M3 | drop `"none"` from `master-worktree-names` | killed |
| M4 | `coordinator-row?` forced to always return `false` | killed |
| M5 | (abandoned mid-edit, reverted before running — not a scored mutant) | n/a |

## Real gap found and closed: back-one was untested at any index but 1

Every existing back-one fixture — unit (`reverse_audit_handoff_test_runner.bb`
line 46/75), property (`bl1299_reverse_hop_property_runner.bb`, generated over
random senders but only asserting the ticket's two invariants), and
acceptance (scenario 01's `cleaner | back-one | coder` row) — used `cleaner`,
which sits at pipeline index 1. At index 1, `(take 1 roles)` (the mutant's
back-all-shaped output) and `[(nth roles 0)]` (the correct singleton) are
byte-identical, so the mutant above was invisible to every check that existed.
This is the "overlapping/coincidental-index fixture" class: the assertion was
real, but the *value* it exercised could not discriminate the mutation
regardless of how many times it ran.

Fixed by adding a second back-one fixture at a deeper index (hardender, index
3, where `back-one` must yield `[architect]` alone rather than
`[coder cleaner architect]`):

- Unit: new check `"hardender back-one reaches only architect, not every
  earlier role"` in `reverse_audit_handoff_test_runner.bb`.
- Acceptance: new Examples row `hardender | back-one | architect` in scenario
  01, re-verified non-vacuous — with M1 re-applied, the unit test fails
  (`FAILURES: 1`) and the acceptance run goes 8/9 (was 9/9 clean).

The declared property invariants (no master-resident addressed; terminal
unchanged) are structurally unable to catch this class of mutant — neither
invariant says anything about back-one's *cardinality* — so no property-side
fix was applicable; the unit + acceptance additions are the fix.

## Verification (post-fix, all commands re-run clean)

| # | command | result |
|---|---------|--------|
| H1 | `bb .../reverse_audit_handoff_test_runner.bb` | ALL PASS (23 checks, was 22) |
| H2 | `bb .../bl1299_reverse_hop_property_runner.bb` | ALL PASS (500 runs) |
| H3 | `specs/pipeline/scripts/run_acceptance.sh <feature>` | 9/9 pass (was 8) |
| H4 | `bb .../test_swarm_handoff_daemon_backup.sh` | ALL PASS |
| H5 | `bash .../test_swarm_handoff_sync_deliver.sh` | ALL PASS |
| H6 | `bash .../test_mailbox_only_delivery.sh` | ALL PASS |
| H7 | `bash .../test_propagation_conf_parsing.sh` | ALL PASS |
| H8 | `bb .../handoff_lib_test_runner.bb` | ALL TESTS PASSED |
| H9 | `bb .../suite_inventory_cli.bb` | ok — 443 files, 439 standing, 4 excluded |
| H10 | `bash swarmforge/scripts/boot_prefix_budget_gate.sh` | ok — 41952/44000 |
| H11 | `npm run compile --prefix extension` | ok |

CRAP/DRY: not applicable — this parcel touches only `.bb` and `.feature`/step
JS files; no `.ts` source under `extension/src` changed (Babashka has no
mutation/CRAP/DRY wired, gated by its own unit suite per Engineering Rules).

No orphaned test/mutation processes left running; no leftover
`./tmp/bl1299-*` directories. `swarmforge/scripts/wait_pipeline_drain.sh`
untracked in this worktree predates this session and was left untouched.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1299-reverse-hop-targets-the-specifier-on-main`.
