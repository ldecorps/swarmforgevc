# BL-1057 — generator defect fixed (per specifier's `BL-1057-generator-defect-20260822.md`)

Per the specifier's evidence file (verified independently, not taken on
report): `bl1057_host_switchover_doctor_property_runner.bb` re-seeded a
fresh `make-rng` per run index (`base + run-index * stride`), which pins a
small-modulus first draw — row 1 (`.vscode/settings.json`, the only
two-key settings row) never landed on `:stale` or `:unreadable` in any of
60 runs, at any run count, structurally. Confirmed the reported
distribution exactly before fixing (57/60 `:absent`, 3/60 `:healthy`, 0
`:stale`, 0 `:unreadable`).

## Fix

Matches the convention every other seeded-LCG `*_property_runner.bb` in
this directory already uses (BL-991 hit the identical defect in its own
new runner this same day and fixed it the same way): ONE `make-rng`
instance created once, advanced across every run's every draw, rather than
re-seeded per run index.

Added a **per-row-1 floor** (not just the fix) — `:row1-healthy`,
`:row1-absent`, `:row1-stale`, `:row1-unreadable`, each ≥3 — tracking the
specific state drawn for `(first default-inventory)`'s id on every run.
The existing aggregate floors (`:stale ≥10`, `:blocked ≥10`) cannot catch
a pin at one draw POSITION, only a pin across the whole run — exactly why
this defect passed every existing floor. The per-row floor is what would
have caught it without a second pair of eyes.

## Non-vacuity, proven by hand

Reverted to the old per-run `(make-rng (+ 977 (* run-index 7919)))`
seeding with the new floors in place: **fails**, `:row1-stale` and
`:row1-unreadable` both reported "produced 0 times, needed >= 3" —
confirming the new floor genuinely detects this exact defect. Restored the
fix; re-ran: **ALL 60 RUNS PASSED**, `:row1-stale 15, :row1-unreadable 12,
:row1-healthy 21, :row1-absent 12` — all four states now reached well
above the floor.

## Re-verification after the fix

- `bb .../bl1057_host_switchover_doctor_property_runner.bb`: **ALL 60 RUNS
  PASSED**.
- `bb .../host_switchover_doctor_lib_test_runner.bb`: **ALL TESTS PASSED**
  (unaffected, unit suite unchanged).
- `specs/pipeline/scripts/run_acceptance.sh` on the BL-1057 feature:
  **11/11** (unaffected).

## Ownership

Per the specifier's note: this file is the hardener's own new addition to
this parcel (added during my BL-1057 hardening pass, above the ticket's
required unit suite), so fixing it is this stage's own job, not a bounce.
Fixed in this follow-on commit rather than left to land broken — the
parcel this note concerns had already been forwarded to documenter before
the note arrived; this commit and a fresh `git_handoff` for BL-1057
supersede that with the corrected property runner.

By hardender.
