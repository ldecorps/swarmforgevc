# Standing property reds do not block unrelated green commits (BL-1175)

*How-to. Task-oriented: land a green parcel when the property suite still
has known standing failures — without using the SKIP override as a habit.*

## The gap

`check_property_suite_drift.sh` (BL-570) refused any commit that staged
`extension/src` or `*.property.test.js` while `npm run test:properties` had
failures — including ~22 pre-existing reds. That stranded an otherwise green
BL-605 tip. `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` is recovery-only
(BL-1121), not the standing recipe.

## What changed

Standing failures are named in
`swarmforge/scripts/property_suite_standing_allowlist.tsv` with disposition
(`allowlist` / `fix`) and rationale. The guard allows the commit when every
reported failing file is allowlisted; any non-allowlisted failure still
blocks and lists those files.

**BL-1234 fix (2026-08-28):** the guard's own path extractor emitted every
normalized failing-file path onto the same line (a missing newline at its
one call site), so `sort -u` saw the whole set as a single, unmatchable
concatenated string whenever **two or more** files were red — which is the
only case that happens in practice once the allowlist names more than one
file. A single failing file worked (`sort` itself supplied the terminator);
two or more always refused, with a message naming a path that does not
exist. Fixed by emitting one path per line before `sort -u` runs; the
verdict now depends on *which* files failed, never on how many.

| Want | Do |
| --- | --- |
| Land green work while known reds remain | Keep those files on the TSV; do not set SKIP |
| New / unowned suite failure | Fix it, or add a TSV row with rationale — do not silent-red |
| Machinery broken | SKIP once for recovery, then restore the standing path |

Also see the updated tables in
[Pre-commit property-suite drift guard](BL-570-property-suite-drift-guard.md).

## A stamp-off invariant used to jam the gate on its OWN ledger row advancing (BL-1356)

Six BL-654 "stamp-off" property tests defend a real invariant — a green
suite must never write a decision into `backlog/hotfix-ledger.yaml` — but
each encoded it by pinning its own row's CURRENT state literal (`/state:
pending/`, `/state: stamp-open/`). A ledger row is not a constant: advancing
it through `stamp-open` → `awaiting-human` → `certified`/`waived` is exactly
the workflow the ledger exists to track, so every one of these tests was
written pre-red — green only until its own row moved, then red for a reason
that has nothing to do with the invariant it defends. Because the drift
guard above refuses any commit touching `extension/src/*` or a
`*.property.test.js` on a non-allowlisted red, one row advancing jammed the
commit gate for every role in the swarm; the allowlist mechanism (BL-1175
itself) had absorbed five instances of this same shape
(`bl1113`/`bl1115`/`bl1116`/`bl1117`/`bl1136`), each with the identical
boilerplate rationale, before the sixth (`bl1323`) jammed four unrelated
commits on 2026-09-02 with no allowlist row yet.

Human ruling (option 1 of two offered): keep the invariants reading the
LIVE ledger, and fix the assertion instead of moving it to a fixture — the
row's state *before* the run under test becomes the expected value,
whatever it is, rather than a hard-coded literal. `extension/test/helpers/stampOff.js`'s
`assertRunWritesNoDecision(hotfix, work, opts)` is the one shared place all
six stamp-off tests now call: it snapshots the watched row before `work()`
runs, runs it, and asserts the row is **byte-identical** afterward — the
non-weakening half of the invariant, checked independently of the
before-value comparison, so a run that genuinely stamps a decision
(`state: certified`/`waived`, a non-null `human_decision`, a non-null
`decided_at`) still fails from ANY starting state, never just from the one
literal a test happened to pin.

With the assertion fixed, `bl1113`, `bl1115`, `bl1116`, `bl1117` and
`bl1136` came OUT of `property_suite_standing_allowlist.tsv` in the same
parcel — leaving a waiver in place once its reason is gone would hide a
future genuine stamp-off regression behind it. `bl1323` was never in the
allowlist (it is the instance that jammed the gate precisely because it had
none) and needed no entry once fixed.

## Verify

```bash
bash swarmforge/scripts/test/test_property_suite_drift_guard.sh
cd extension && npm test -- bl1175PropertySuiteStandingRedsInvariants
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1175-property-suite-standing-reds-block-unrelated-commits.feature
bash extension/scripts/bl1356_stampoff_mutation_sweep.sh
cd extension && npm test -- bl1356StampOffHelper bl1356StampOffInvariants
```

Related: [BL-1121 reconcile import skip](BL-1121-reconcile-import-skips-property-suite-guard.md),
[BL-1124 shared-repo canary](BL-1124-property-suite-fixtures-must-not-mutate-shared-main.md).
The six stamp-off files individually: [BL-1116](BL-1116-swarm-stamp-extension-wip-hotfixes-20260824.md),
[BL-1117](BL-1117-swarm-stamp-pipeline-board-numeric-nbsp.md),
[BL-1136](BL-1136-swarm-stamp-babysitterd-cursor-forge-fbf6f1a909.md),
[BL-1115](BL-1115-swarm-stamp-main-sync-status-cli-ahead-behind-swap.md).
