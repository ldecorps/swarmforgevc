# BL-1374 — architect review, pass (2026-09-03)

## Scope reviewed

Cleaner's tip (`6fd8df2f5f`), merged cleanly (no conflicts) into this
worktree. This is a fix to the land step's own attribution logic — the same
file BL-1375/BL-1378 touched today — so I read `merge-authored-paths` and
the reworked `path-owner-tickets` directly rather than trusting the green
suites alone.

## Dependency gate / co-change

`cd extension && node out/tools/dependency-gate.js
../specs/pipeline/steps/bl1374SyncMergePassengersSteps.js` — PASSED, no
forbidden edges. Co-change: entirely in-scope.

## Direct read of the mechanism

- `merge-authored-paths` reads `git diff-tree --no-commit-id --cc -r
  <commit>` and keeps only paths carrying a `diff --cc`/`diff --combined`
  header (the DENSE combined-diff, emitted only where the merge result
  differs from every parent's OWN resolution — i.e. the merge genuinely
  wrote content) — never the `--cc --name-only` list, which names every path
  differing from all parents even when a clean auto-merge wrote nothing
  there. This is the correct discriminator; using `--name-only` (what the
  ticket's own `required_wiring` line names) would reinstate exactly the
  over-report this ticket fixes — confirmed by re-deriving the coder's own
  measured table against `5d4486eb08` rather than trusting the claim.
- Returns `nil` (never `#{}`) on an unreadable diff — this file's standing
  fail-open convention.
- `path-owner-tickets`'s `reduce` (line 643-652): non-merge commits are
  added unconditionally; a merge commit is added only when
  `merge-authored-paths*` contains the path; an unreadable combined diff
  short-circuits via `(reduced nil)`, propagating blindness through the
  whole reduction rather than reading as "the merge wrote nothing" — matches
  invariant 1 (a genuine entanglement is never silently waved through).
- The one case a merge legitimately owns — a resolved conflict — is kept,
  because `merge-authored-paths` reports any path the combined diff produced
  a patch for regardless of provenance. This is invariant 3's required
  exception, and is exactly what `qa_e2e_procedure` step 5 asked to be
  constructed or disclaimed — the coder constructed it (fixture 05,
  `:resolved-merge` property shape) rather than disclaiming it.
- Memoization (`merge-authored-paths*`) is keyed on `(root, commit)`; safe
  by construction since a commit sha addresses immutable content.

## Invariants (BL-633/654) — all three declared, all three covered

1. Genuine entanglement still refused — P1, both directions (false-negative
   AND false-positive checked; the coder's own self-audit found and closed
   a vacuity trap where the pre-fix break produced zero property failures
   because every assertion was gated behind "if the run replayed"). Read the
   runner and confirmed `:entanglement-expected?` is now asserted
   independently of whether the run replayed.
2. Detection stays as wide as today — P2, every sibling on the tip and not
   on origin/main still reported.
3. No own path dropped from the replay — P3, plus the resolved-merge
   exception. NON-VACUOUS (making merges own nothing → 10 FAIL properties, 3
   FAIL unit).

## `required_wiring` anchor — spec-gap, not a code defect

The ticket's anchor names `own-commit-changed-paths` as "the delivered-side
path set this ticket narrows"; the coder's own measurement (and my
independent read above) shows the actual narrowing landed in
`path-owner-tickets`/the new `merge-authored-paths`, a different function.
The anchor string is present in the file (discussed in five comments) so the
grep-based gate passes, but for a coincidental reason — using the anchor's
named function (`:authored`, i.e. `--cc --name-only`) would have reinstated
the defect this ticket fixes, per the coder's own rejected-on-evidence note.
Both coder and cleaner already flagged this; I agree it doesn't weaken the
gate's actual guarantee here (the acceptance handler IS registered and
reachable, which is the load-bearing check) and doesn't block forwarding —
routing as a `note` to the specifier per the spec-gap protocol rather than
holding the parcel.

## Verification run directly

- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — ALL PASS.
- `bash swarmforge/scripts/test/test_bl1374_sync_merge_passengers.sh` — ALL
  PASS (18 checks, including the live `5d4486eb08` regression: the passenger
  keeps its own path, the merge is no longer credited, and the "premise"
  checks confirm the merge wrote no line at that path despite `--cc` naming
  it — the exact trap this ticket closes).
- `bb swarmforge/scripts/test/bl1374_sync_merge_passengers_property_runner.bb`
  — ALL PROPERTIES HOLD (24 fixture runs).
- Land-step neighbors, unchanged: `bl1131_ticket_land_property_runner.bb`,
  `bl1334_land_replay_approval_property_runner.bb`,
  `land_main_publish_test_runner.sh`, `test_land_step_records_approval.sh`
  — all green.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1374-*.feature` — 4/4.
- `specs/pipeline/steps/index.js` — `bl1374SyncMergePassengersSteps`
  registered.

## Property-testing pass (own section, BL-654 scope boundary)

All three declared invariants are the ticket's obligation, covered above.
No other touched pure module needs new coverage.

## Correctness read

No defect found in the mechanism. Flagged the `required_wiring` anchor
mismatch as a spec-gap `note` (below), not a send-back — the code is
correct and the gate's real guarantee (registration/reachability) holds
regardless.

## Verdict

No code defect found. Forwarding to hardener. Filing a `note` to specifier
+ coordinator about the `required_wiring` anchor text.
