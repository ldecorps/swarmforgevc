# Unregistered-test send-time gate on `git_handoff` sends (BL-1240)

*How-to. Task-oriented: understand why a `git_handoff` send was refused
for adding an unregistered test file, and how to clear it.*

Send-time gate in `swarm_handoff.bb`, alongside the other send-time gates
(`ticket_close_guard_lib.bb`, `duplicate_chain_guard_lib.bb`,
`task_commit_coherence_gate_lib.bb`, `parcel_rollback_guard_lib.bb`,
`tree_collapse_guard_lib.bb`). Full mechanics:
[`swarmforge/handoff-protocol.md`](../../swarmforge/handoff-protocol.md#unregistered-test-send-time-gate-bl-1240).

## What it catches

A parcel that adds a file under `swarmforge/scripts/test/` with no row in
that directory's `suite-manifest.tsv`. Before this gate,
[`suite_inventory_cli.bb`'s tree-wide check](BL-973-bb-fixture-closure-guards-and-suite-inventory.md)
only fired when `run_bb_suite.sh` ran the whole standing suite, so an
unregistered file accumulated invisibly — measured at roughly six a day
over five days, ending with the suite refusing to start at all (39 names
in the failure, the backlog BL-1239 exists to clear). The refusal always
landed on QA, holding a list of OTHER tickets' omissions QA cannot
reasonably author: choosing `standing` versus `excluded` needs the reason
the test was written, which lives with its author and its ticket, not
with whoever happens to run the suite next.

## How it decides

The check is **parcel-scoped, never tree-scoped** — it asks only "does
THIS parcel add an unregistered test file", reusing
`task_scope_gate_lib.bb`'s own commit-walk (`parcel-own-changed-paths`,
now a public seam shared with BL-1192's task-scope gate) to find the
parcel's own added paths. A parcel that touches no test file at all
passes even while other tickets' files sit unregistered elsewhere in the
tree — a tree-scoped copy of the check would relocate BL-1239's drift
problem onto every unrelated parcel instead of ending it.

What counts as a test file and what a manifest row says are both asked of
`suite_inventory_lib.bb` — the same code `suite_inventory_cli.bb` runs —
rather than re-derived, so this gate and the tree-wide check cannot drift
into two different notions of "registered" the way the runner list and
the manifest once did (BL-973). A path the parcel **deleted** is never a
finding: it no longer exists, and a stale row for it is the tree-wide
check's business.

The silent-row half — a manifest row whose first column names no existing
test file — is already refused by BL-1239's own `suite_inventory_lib/check`
(reported MALFORMED for a non-test-file name, missing for an absent one).
This gate does not re-validate rows itself, deliberately: a parcel that
merely touches the manifest must not be refused for another ticket's
already-malformed row — the tree-wide check owns the manifest, the
send-time check owns the parcel.

## Fixing it

The refusal names the file and quotes the exact row it needs:

```text
Cannot send git_handoff for BL-1240: this parcel adds a test file
(swarmforge/scripts/test/test_example.sh) under swarmforge/scripts/test/
with no row in suite-manifest.tsv (BL-1240). An unregistered test file is
invisible to the standing suite, and the refusal would otherwise land on
QA instead of here. Add to swarmforge/scripts/test/suite-manifest.tsv:
swarmforge/scripts/test/test_example.sh	standing
...or, if it should not run on every parcel, lane `excluded` with a
YYYY-MM-DD date and the reason.
```

1. If the test should run on every standing-suite pass, add the quoted
   `standing` row exactly as given (tab-separated, empty `date`/`reason`
   columns) to `swarmforge/scripts/test/suite-manifest.tsv`.
2. If it should NOT run on every parcel (slow, manual, or live-only),
   change the row's second column to `excluded` and fill in a real
   `YYYY-MM-DD` date and reason — "it is failing" is never a legitimate
   reason (see [BL-973](BL-973-bb-fixture-closure-guards-and-suite-inventory.md#the-standing-suite-inventory-half-2)).
3. Commit the manifest edit and re-send:

```bash
vim swarmforge/scripts/test/suite-manifest.tsv
git add swarmforge/scripts/test/suite-manifest.tsv
git commit -m "BL-1240: register test_example.sh in suite-manifest.tsv"
swarm_handoff.sh ./tmp/handoff.txt
```

## Where it lives

| Piece | Location |
| --- | --- |
| Guard library | `swarmforge/scripts/unregistered_test_gate_lib.bb` |
| Wired into | `swarmforge/scripts/swarm_handoff.bb` (send-time `validate`) |
| Acceptance steps | `specs/pipeline/steps/bl1240UnregisteredTestFailsAuthorSteps.js` |

## Related

- [Nine guarded fixture copy-lists, and a standing test-suite inventory](BL-973-bb-fixture-closure-guards-and-suite-inventory.md)
  — the tree-wide inventory check and manifest format this gate reuses
  rather than re-deriving; still the check `run_bb_suite.sh --inventory`
  runs, and still the one that owns row validity.
- [Shell-test discovery](BL-724-orphan-red-shell-test-untracked-and-undiscovered.md)
  — a related but distinct sweep for untracked/unaccounted `test_*.sh`
  files, orthogonal to this send-time registration check.

## Verify

```bash
bb swarmforge/scripts/test/unregistered_test_gate_lib_test_runner.bb
bb swarmforge/scripts/test/bl1240_unregistered_test_gate_property_runner.bb
node specs/pipeline/cli.js specs/features/BL-1240-unregistered-test-fails-the-ticket-that-adds-it.feature
```

Acceptance: `specs/features/BL-1240-unregistered-test-fails-the-ticket-that-adds-it.feature`
