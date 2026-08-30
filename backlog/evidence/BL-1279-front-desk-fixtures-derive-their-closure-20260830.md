# BL-1279 — the front-desk supervisor fixtures derive their bb closure

Coder, 2026-08-30.

## What shipped

1. **Derivation, not a patch.** All four fixtures' hand-written `cp` line is
   replaced by `copy_bb_closure "$SRC" "$d" front_desk_supervisor.bb`, the
   helper BL-973 built for exactly this rot. The two missing edges
   (`daemon_log_freshness_pulse_lib.bb`, `self_heal_telemetry_lib.bb`) are not
   named anywhere in this parcel — they arrive because the closure has them.
2. **A load guard**, `swarmforge/scripts/test/lib/bb_fixture_load_guard.sh`,
   called from each fixture immediately after its root is populated and BEFORE
   the first check.
3. **Enrolment**: the four are now `shell-copy` entries in
   `bbFixtureClosureGate.js`'s `FIXTURES`, entry `front_desk_supervisor.bb`.
4. Acceptance step handlers, registered in `specs/pipeline/steps/index.js`.

## Invariant 2 needed its own mechanism, and here is why a load PROBE is not it

The ticket's third constraint is the important one: fixing only the copy-list
"satisfies the letter of the red while leaving that hazard exactly where it
is". Five of the refusal test's eight checks passed against a process that
never started, because a crash also exits non-zero, also writes no pid file,
and also writes no `received-env.json`.

The obvious remedy — load the entry point and see whether it loads — is not
available: `front_desk_supervisor.bb` ends in a bare `(-main)`, so loading it
RUNS it. So the guard asserts the entry point's transitive closure, computed
from the real source tree by the same Babashka CLI `copy_bb_closure` derives
from, is present in the fixture root. It runs before the first check and
`exit 1`s, so a fixture that cannot load prints no `ok` line at all.

Verified by hand before it was automated: build a root, delete
`self_heal_telemetry_lib.bb`, run the guard →

```
FAIL - bb fixture load guard: front_desk_supervisor.bb cannot load in <root> - missing from its closure: self_heal_telemetry_lib.bb
no check was run: a subprocess that never starts satisfies negative assertions by accident
exit=1
```

## The declared invariants (BL-654)

`extension/test/bl1279FrontDeskFixtureClosure.property.test.js`, property lane
only.

**Invariant 1** cannot be tested on the shipped tree: a hand-list and a derived
list agree exactly on the tree the hand-list was written against — which is why
four wrong lists looked fine for months. So every draw MUTATES the tree, adding
load-file edges no list author could have known, and asserts the copy set still
equals the closure. A hand-list fails every such draw by construction.

Reach is constructed on the axis that decides the answer: **depth**. An edge
added to the entry point is found by any one-level scan; an edge added to a lib
the entry point loads is found only by a transitive walk. Each depth gets its
own `fc.assert` run, so the floor is met by construction — a shared
`fc.constantFrom` was tried and drew one depth once in six runs, failing the
floor at random.

**Invariant 2** is drawn over the closure MEMBER removed, exhaustively (the
domain is the nine-file closure, finite and enumerable). Per-file matters: the
original defect died at ONE specific edge, and a guard keyed to that filename
would look just as green.

**Non-vacuity, both shown by running:**
- invariant 1: made `copy_bb_closure` hand-list the nine files instead of
  deriving them → the property FAILS (the mutated tree's new edge is not
  copied). Restored, green.
- invariant 2: made `assert_bb_closure_present` return 0 immediately → the
  property FAILS (the run exits zero and a check reports `ok`). Restored,
  green.

## Runs

| what | result |
|---|---|
| `test_front_desk_supervisor_bl622_refusal.sh` | exit 0, ALL CHECKS PASSED (was 3 FAIL / 8) |
| `test_front_desk_supervisor_tick.sh` | exit 0, ALL CHECKS PASSED (was: died at load) |
| `test_front_desk_supervisor_liveness.sh` | exit 0, ALL CHECKS PASSED (was: died at load) |
| `test_front_desk_supervisor_fleet_creds.sh` | exit 0, ALL CHECKS PASSED (was: died at load) |
| BL-1279 acceptance | 10/10 |
| BL-1279 property lane | 2/2 |
| `bbFixtureClosureGate` over all nine enrolled fixtures | 0 missing, each one |
| `extension/test/operatorRuntimeBbFixtureClosure.test.js` | 10 pass / 2 fail — **and 4 pass / 2 fail at HEAD**: the same two reds, six more passing checks from the four new enrolments |

## One red that is not mine, and blocks a scenario the ticket asks me to re-run

`suite_inventory_cli.bb` reports **1 problem over 434 test files**:

```
FAIL: first column is not a test file name: "task_scope_gate_acceptance_exemption_property_runner.bb"
      - column 1 must name a test_*.sh or *_test_runner.bb file
```

That row was added to `swarmforge/scripts/test/suite-manifest.tsv` by
**BL-1276** (`d6d65df53`), which is QA-landed and merged into this worktree as
`9706a8b9f`. It is not reachable from anything this parcel touches: ~140 other
`*_property_runner.bb` files exist and are correctly absent from the manifest,
because the inventory's column-1 rule admits only `test_*.sh` and
`*_test_runner.bb`.

The consequence for this ticket: **BL-973's acceptance is 12 pass / 1 fail**,
and the failing scenario is `every bb test file is run by a standing gate or
explicitly excluded` — one of the two inventory scenarios the ticket's step (5)
asks me to confirm unchanged. BL-973's five original fixtures and both closure
scenarios pass; only that inventory scenario is red, on a row this parcel did
not write. Surfaced to the specifier by note rather than fixed here: the row
belongs to BL-1276's slice, and removing another ticket's manifest row is the
sweep this constitution forbids.

## Left as found

- The second-order defect the ticket records in `out_of_scope`: `FIXTURES` and
  BL-973's Examples table remain hand-enumerated, so a TENTH fixture could
  still copy `.bb` files unguarded. Not folded in.
- `front_desk_supervisor.bb` itself: untouched.
- BL-973's five existing fixtures and its Examples table: untouched.
