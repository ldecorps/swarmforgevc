# BL-1377 — architect review, pass (2026-09-03)

## Scope reviewed

Cleaner's tip (`7b32e9f5f6`), merged cleanly (no conflicts) into this
worktree at `Merge cleaner 7b32e9f5f6 for BL-1377. By architect.`
`swarmforge/` is Babashka — no mutation/CRAP/DRY wired (BL-472 deferred),
gated by its own unit/CLI/property suites plus the JS mutation-site-count
advisory, already run by the cleaner.

## Dependency gate / co-change

`cd extension && node out/tools/dependency-gate.js
../specs/pipeline/steps/bl1377SuiteBaselineSteps.js` — PASSED, no forbidden
edges. Co-change: entirely in-scope (own lib/CLI/tests, index.js, evidence).

## Architecture read

- `suite_baseline_lib.bb` (`decide`, `parse-failures`, `record-matches?`,
  `evidence-line`) is pure — read it end to end: no `git`, `fs`, or process
  call anywhere. `suite_baseline_cli.bb` is the only impure layer (base sha
  resolution, config hash, record file, both suite runs via one `run-suite`
  seam, the throwaway base worktree).
- Traced the actual decision flow in `suite_baseline_cli.bb:163-197`: the
  parcel's own suite runs first (`observed`); `decide` is called against the
  record. When the record doesn't match or the sets differ
  (`:second-run? true`), the CLI does NOT trust the stale record — it
  measures the REAL base commit in a throwaway worktree and re-`decide`s
  against those real `base-reds`, then (when the key was fresh) appends a
  new baseline record. A record can never colour the answer when it
  disagrees with reality — verified by reading the code, not just the
  evidence's claim.
- `:excused` is exactly `(filter observed-set recorded)` in `decide` — only
  reds that are both recorded AND currently observed; a record can shrink
  what a run has to re-verify but can never widen what it excuses beyond
  what's actually in front of it. This is invariant 1, read directly in the
  source, not just trusted from the property's pass.
- Every unusable-record path (`record-error`, `nil? record`, mismatched key)
  returns `:second-run? true` with `:excused []` — no path yields a green
  from a missing or wrong-key record. This is invariant 2, likewise read
  directly.
- `parse-failures` returning `nil` (distinct from `[]`) for output it cannot
  parse, with the CLI refusing on `nil` rather than treating an unreadable
  run as a clean one — a real defect the coder's own self-audit caught
  (finding 2) and closed before this ever reached me; verified the fix is in
  place and covered (CLI check `01b`).

## Invariants (BL-633/654) — both declared, both covered

1. A record excuses only a red it names, at the same base sha and config
   hash; cache shrinks a run, never widens an excuse — P1. NON-VACUOUS
   (unconditional excuse + skipped forcing → 244 FAIL P1).
2. Absent/unreadable/mismatched record falls back to two runs; no path turns
   a missing baseline into a green — P2. NON-VACUOUS (treating any present
   record as usable → 593 FAIL P2).

Generator reach: confirmed by reading the runner that the observed set is
derived FROM the recorded one by the transformation under test (not drawn
independently) — otherwise the exact-match case that can skip a run would be
vanishingly rare and P1 would pass trivially. All six record shapes, five
observed shapes, and the `[:match :same]` pair are asserted as generated,
not merely hoped for.

## Verification run directly

- `bb swarmforge/scripts/test/suite_baseline_lib_test_runner.bb` — ALL PASS.
- `bash swarmforge/scripts/test/test_suite_baseline_cli.sh` — ALL PASS (37
  checks), including 07 (HEAD doesn't move, base worktree removed) and 06
  (the standing allowlist stays an independent input, never touching the
  record).
- `bb swarmforge/scripts/test/bl1377_suite_baseline_property_runner.bb` —
  ALL PROPERTIES HOLD (500 runs).
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1377-*.feature` — 10/10.
- `specs/pipeline/steps/index.js` — `bl1377SuiteBaselineSteps` registered.
  No `required_wiring` declared, with a stated reason (the consumer is a
  role-prompt evidence sentence, not a code call site — a specifier
  deliverable per BL-798) — read and agree, same shape as BL-1376's own
  exemption.

## Property-testing pass (own section, BL-654 scope boundary)

Both declared invariants are the ticket's obligation, covered above. No
other touched pure module needs new coverage.

## Correctness read

No defect found beyond what the coder's own self-audit already caught and
fixed (evidence sentence missing `recorded-by`; unreadable-run-as-green;
32-bit config hash collision risk → SHA-256/16-hex) — read each fix in the
source and confirmed present. Cleaner's dead-key removal (`:ran-base?`) is a
correct, no-behavior-change simplification, confirmed by re-running the full
suite after.

## Verdict

No defect found. Forwarding to hardener.
