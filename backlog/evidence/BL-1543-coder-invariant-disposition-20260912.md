# BL-1543 coder invariant disposition

## Declared invariant

> After the test exits, no process whose command line names its fixture
> root exists - the daemon it spawned, the launcher its repair bounced, and
> anything they started are all gone (pgrep -af <root> empty).

## Disposition: no executable property test authored (stated reason)

This invariant quantifies over live OS process table state produced by
booting the REAL `handoffd.bb` daemon (constraint: "the test keeps
executing the REAL handoffd.bb - it is a wiring test, not a lib test";
`handoffd.bb`/`master_checkout_drift_lib.bb`/`start_handoff_daemon.sh` are
out of scope for this parcel). It is not a property over a pure, testable
module:

- A `*.property.test.js` generator would have to either (a) fake the
  daemon/OS process layer, which reproduces exactly the shape the ticket's
  FIRM constraint forbids (a fake-driven version "would duplicate BL-1139's
  acceptance and prove nothing about the daemon"), or (b) spin up many real
  `bb handoffd.bb` boots per property run. Each real boot in this suite
  takes ~9s wall time (measured: two fixtures, ~17s acceptance total for
  both scenarios) purely to satisfy the sweep's poll cadence - a
  property-test iteration count sufficient to be non-vacuous (per this
  ticket's own generator-reach standard) would multiply that by 100+,
  turning a `slice_size_envelope: low` / `mutation_cost: low` parcel into a
  multi-minute property suite for one process-table assertion.
- The invariant's real domain - "did anything survive process teardown" -
  is inherently a single concrete-run observable (pgrep against a real PID
  table), not a value space a generator varies inputs over; there is no
  meaningful "shrinking" dimension here distinct from the two fixtures the
  suite already exercises (in-flight repair bounce vs. no bounce).

## What proves the invariant instead

Scenario 02 of `BL-1543-the-drift-wiring-test-asserts-the-daemons-live-repair-contract.feature`
("the wiring test leaves no process rooted in its fixture behind") runs the
REAL suite once and asserts, against the real printed fixture roots:
`pgrep -af <root>` reports no match, and the root no longer exists on disk.
This is the ticket's own acceptance mechanism for this invariant - proven
in `specs/pipeline/steps/bl1543DriftWiringLiveContractSteps.js` (steps for
"no process whose command line names a printed fixture root survives the
run" and "no printed fixture root still exists on disk"), and manually
re-verified against a fresh run during implementation (both printed roots
absent from disk and from `pgrep -af` output after exit 0).

The suite's own `cleanup()` EXIT trap (kill tracked daemon PIDs, `rm -rf`
each registered root) is the mechanism the invariant is actually watching;
scenario 02 is the executable check that the mechanism holds on a real run.
