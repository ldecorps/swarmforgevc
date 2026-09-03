# BL-1327 — architect pass, 2026-09-03

Reviewed cleaner commit `b32d2108b1` (no cleaner evidence file — clean merge,
no defect implied), forwarding coder's descent-ladder proposal-only slice.

## Governance boundary, verified by code inspection (not trust)
- `descent_review_cli.bb` has exactly ONE `write-json!` call site, targeting
  `.swarmforge/descent-ladder/proposals.json` — confirmed by `grep -n
  "spit\|write\|apply\|claude-settings\|swarmforge.conf" descent_review_cli.bb`.
  No code path touches a pack conf or a launch-settings file.
- `descent_ladder_lib.bb` has no apply verb at all — `descent-decision` and
  `record-guard-trip` both return data; neither performs IO.
- Acceptance scenarios seed BOTH real seat-facing files (a
  `.claude-settings.json` and a pack conf line) and assert byte-identity
  against them after every review call (three separate scenarios use this
  check, confirmed at `bl1327DescentLadderProposalSteps.js:190-245`) — the
  governance claim is proved, not merely asserted in prose.

## The three declared invariants, verified in the code
1. Streak-before-descent: `(< streak needed)` checked before any proposal
   branch — confirmed reading `descent_ladder_lib.bb`.
2. Guard-trip discards progress and climbs back (or holds with no known-good
   recorded, never inventing one) — `guard-tripped?` is the FIRST cond
   branch (checked ahead of the streak check too), and `record-guard-trip`
   correctly falls back to the current notch when no `last-known-good`
   exists rather than fabricating one.
3. Effort exhausted before model: `lower-effort` branch precedes
   `cheaper-model` branch in the `cond`; a cheaper model always starts at
   `"high"`, never at `(first effort-ladder)` (low) — confirmed by reading
   the source and by the property test's explicit
   `assert.notEqual(d.proposal.effort, EFFORTS[0])`.
- Effort ladder reused from `seat_difficulty_lib/adapt-effort-ladder`
  (BL-1317's own), not re-declared — confirmed: `(def effort-ladder ...
  seat-difficulty-lib/adapt-effort-ladder)`.

## Checks run (not assumed)
- `bb swarmforge/scripts/test/descent_ladder_lib_test_runner.bb` — ALL PASS.
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-1327-scheduled-descent-ladder-proposes-cheaper-notch.feature`
  — 4/4 scenarios pass.
- `node extension/out/tools/dependency-gate.js` on the property test —
  PASSED, no forbidden edges.
- Property test flakiness check: invariants 2 and 3 iterate the full
  cross-product of their input space (deterministic reach by construction).
  Invariant 1 relies on aggregate probability across 24 draws
  (4 efforts × numRuns 6, `fc.boolean()` for guard-tripped at p=0.5 — very
  safe margin, unlike BL-1343's original 1/6 corner). Ran 10 consecutive
  times — 10/10 clean.
- required_wiring: `install_descent_review_cron.sh` confirmed wired into
  `install_swarmforge_crons.sh:37`, in the same parcel, matching the
  freshness/shift-schedule sibling pattern exactly (same
  `SWARMFORGE_SKIP_*_CRON` guard shape, confirmed at
  `install_swarmforge_crons.sh:14-39`).
- Idempotency: `install_descent_review_cron.sh` filters out its own prior
  marker line (`grep -vF "$MARKER"`) before re-adding — confirmed reading
  the source.

## Scope respected
`descent-ladder` state/config/proposals all live under
`.swarmforge/descent-ladder/`, untouched pack-conf/launch-settings paths
confirmed above. BL-548's calibration loop and the auto-apply ruling option
correctly out of scope per the human's ruling.

## Verdict
Clean sweep. No defect found. Forwarding to hardener.
