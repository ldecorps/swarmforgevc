# BL-805 rotate-gate-on-unfinished-in-process-parcel — 20260805 (architect)

## Verdict: PASS, forwarded to hardener

## What was reviewed

Merged cleaner's `74f2b65e20` (ancestor chain: coder `4a01bec0` → cleaner)
into the architect worktree and reviewed the combined parcel. No files
under `extension/src` or `media` are touched other than the new
`extension/test/bl805RotateGateOnUnfinishedInProcessParcel.property.test.js`,
so most of `.dependency-cruiser.cjs`'s view/host/webview-storage/secrets
rules are not in scope — this is a Babashka swarm-script change
(`swarmforge/scripts/handoff_lib.bb`, `mono_router_lib.bb`) plus Gherkin
step wiring, not extension architecture.

## Dependency-rule gate

`node extension/out/tools/dependency-gate.js test/bl805RotateGateOnUnfinishedInProcessParcel.property.test.js`
(run with cwd=`extension/`, matching the tool's own `EXTENSION_ROOT`-relative
resolution) — PASSED, no forbidden edges.

## Logical coupling: co-change-report.js

Ran against `swarmforge/scripts/handoff_lib.bb`, `mono_router_lib.bb`, and
`specs/pipeline/steps/index.js`. `handoff_lib.bb`'s top co-changers
(`handoffd.bb`, `swarmforge.sh`, the `ready_for_next_*`/`done_with_current_*`
scripts, `index.js`) are the same long-established core-module coupling
this file always carries — none of those files were touched by this parcel,
so nothing here indicates a missed companion change. `index.js`'s own long
SUSPECTED list is registration-hub noise (every feature touches it).

## Required wiring (ticket's `required_wiring:`)

"the gate must run in the resident-invoked entry, not only in a lib
function" — confirmed: `rotate_to_role.bb`'s only call is
`handoff-lib/respawn-as!`, and the gate (`departing-role-blocking-handoff`
+ `mono-router-lib/rotate-gate-decision`) runs inside `respawn-as!` itself,
before it dispatches to `rotate-resident-to!`. `handoffd.bb`'s daemon chase
calls `rotate-resident-to!` directly and never passes through
`respawn-as!` — verified by reading `handoffd.bb` (unchanged by this
commit) and confirmed live by e2e scenario 04 below.

## Invariants Review (both declared invariants)

1. "The gate blocks only resident-invoked rotation ... daemon-initiated
   rotation ... is never blocked" — `rotate-resident-to!` itself is
   untouched by this diff; the gate lives one layer up, only in
   `respawn-as!`. Property test "invariant 1" drives the daemon path
   directly (`bb -e '(handoff-lib/rotate-resident-to! "cleaner")'`, the
   exact call `handoffd.bb`'s chase makes) across 7 in_process shapes
   (empty/sidecars/junk/mixed/handoff-alone/handoff-buried/
   multiple-handoffs) and asserts it always succeeds and always respawns.
2. "Only real parcels gate: a file blocks rotation only if it matches
   ...`*.handoff`... — sidecars never block" — property test "invariant 2"
   drives the real resident-invoked path (`rotate_to_role.sh`) across the
   same 7 shapes and asserts refusal iff a real `*.handoff` file is
   present, proceed otherwise. Sidecar filenames are deliberately crafted
   to contain the substring `.handoff` mid-name
   (`case_sidecar0.handoff.nudge`) to prove the filter is a true suffix
   match, not a substring check.

Both property tests are non-vacuous — verified myself, not just trusted the
commit message: temporarily changed `rotate-gate-decision` in
`mono_router_lib.bb` to always return `:proceed` and re-ran
`mono_router_lib_test_runner.bb`; it failed on exactly the two assertions
that exercise the blocking-file branch, confirming the unit coverage bites.
Reverted before continuing (`git status` clean afterward).

## Fail-open constraint (notes, not a formal declared invariant)

The ticket's CONSTRAINTS section requires failing open (rotate proceeds)
when the departing role can't be determined — missing marker, blank
marker, or a role absent from `roles.tsv`. No automated test drives this
specific path (all e2e/property fixtures always populate a valid marker),
but the implementation (`departing-role-blocking-handoff`) is three short
guard clauses (`fs/exists?` → `blank?` → `load-role-info` nil-check), and I
verified all three fail-open branches by hand in an isolated fixture (`bb
-e` against a bare `.swarmforge/` with no roles.tsv/marker, then a
blank marker, then an unknown-role marker) — all three returned `nil`
(→ `:proceed`) as designed. Not a defect; noting the manual verification
since it isn't covered by the automated suite.

## Acceptance feature

`node specs/pipeline/cli.js specs/features/BL-805-rotate-gate-on-unfinished-in-process-parcel.feature`
— all 5 scenarios pass (5/5). Also ran the underlying e2e shell test
(`test_rotate_to_role_stuck_parcel_gate.sh`) and the bb unit runner
(`mono_router_lib_test_runner.bb`) directly — both green. Ran the property
test suite (`npm run test:properties` scope, via `npx vitest run --config
vitest.properties.config.mjs test/bl805...property.test.js`) — 2/2 pass.

## Property testing (undeclared coverage)

No other pure module was touched this parcel beyond the two invariant-
covered functions above; no further property-test action needed.

No violations found. Forwarded to hardener with the same task name.
