# BL-678 architect pass — 2026-08-18 (round 2, post-bounce)

## Scope

Received from cleaner as `merge_and_process cleaner 03920a72ed`. Reviewed
commit `03920a72ed` ("BL-678: remove dead within-cooldown? with backwards
rationale comment", by cleaner) fresh, from scratch, as the remediation for
this same ticket's round-1 architect bounce
(`backlog/evidence/BL-678-batch-claim-progress-sidecar-bounce-20260818.md`,
D1: dead `within-cooldown?` function with a factually-backwards coupling
rationale).

Files reviewed (`git show 03920a72ed`):
- `swarmforge/scripts/batch_claim_progress_lib.bb` (deletion only, -10)
- `swarmforge/scripts/test/batch_claim_progress_lib_test_runner.bb`
  (deletion only, -9)

## D1 remediation verified

- The exact function named in the bounce (`within-cooldown?`) and its 3
  dedicated unit test assertions are deleted, nothing else touched — matches
  the bounce's stated remediation precisely (deletion, not a rewire, since
  every real call site already agreed on
  `chase-sweep-lib/within-dropped-parcel-cooldown?`).
- Grepped `swarmforge/`, `specs/`, `extension/`, `backlog/` for
  `within-cooldown?`: zero remaining references to
  `batch-claim-progress-lib/within-cooldown?`. The unrelated hits are a
  same-named keyword arg in `chase_sweep_lib.bb`/`handoffd.bb`'s
  `decide-open-slot-nudge?` and unrelated `mono_router_lib` property-test
  generator bindings — pre-existing, different namespace, not this
  function.
- No orphaned comment, blank-line artifact, or dangling reference left
  behind at either deletion site (checked file tails by hand).

## Checks re-run (complete inventory, not first-failure-stop)

1. **Dependency-rule gate (BL-259 hard gate)** — N/A, same as round 1: both
   changed files are under `swarmforge/scripts/`, outside `extension/`'s
   scan root (`node extension/out/tools/dependency-gate.js` on the two
   files errors that they aren't part of its scope — confirmed, no
   forbidden edge to report).
2. **Co-change coupling (BL-255)** — re-ran `co-change-report.js` against
   both changed files. All counts are 1-2, below the default
   min-frequency-3 threshold — no SUSPECTED COUPLING flagged, consistent
   with round 1 (this round touches only pre-existing, already-reviewed
   files with a pure deletion).
3. **Invariants (BL-633/654)** — both declared invariants re-verified
   against the post-fix code:
   - `bl678_batch_claim_progress_invariants_property_runner.bb` → ok (P1
     sidecar-exists-claim-to-completion, P2
     fresh-progress-never-surfaces), unaffected by the deletion since
     neither invariant's production path ever called the dead function.
   - `batch_claim_progress_lib_test_runner.bb` → ok, 3 fewer assertions
     (the deleted dead-code tests), all remaining assertions green.
   No violation.
4. **Property coverage (undeclared)** — unchanged from round 1: the
   touched pure module's remaining functions are already covered by the
   invariant properties plus the example-based unit tests above. Deleting
   dead code and its own dedicated test introduces no new gap.
5. **Acceptance (BL-761/880 contract)** — re-ran the full feature
   end-to-end: `node specs/pipeline/cli.js
   specs/features/BL-678-batch-claim-progress-sidecar.feature` → 5/5
   scenarios PASS, driving the real production scripts.
6. **Correctness read** — clean; the diff is a pure deletion matching the
   bounce's remediation exactly, no new defect introduced.

## Verdict

No architecture violation, no invariant violation, no correctness defect
found. D1 from the round-1 bounce is fully and correctly remediated. Clean
pass — Article 4.4 explicit-NONE evidence, committed per the BL-806
review-forward-evidence gate. Forwarding to hardener.

By architect.
