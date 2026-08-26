# BL-1076 — hardener pass

Forwarded from the architect (merged cleanly at `24b29a708d`, no conflicts).
Babashka: per the Startup Tools article, no mutation/CRAP/DRY tooling is
wired for this surface — gated only by its own unit-test suite, which the
coder and architect both already exercised thoroughly (240-run property
runner across 5 declared invariant classes, exhaustive non-sampled consumer
sweep for both changed function arities). Re-verified everything live rather
than trusting the evidence files at face value, per this role's standing
practice.

## Verification, re-run live

- `bb swarmforge/scripts/test/bl1076_visible_work_gate_property_runner.bb`:
  **240 runs, ALL PROPERTIES HOLD**, covering all 5 declared invariant
  classes (P1-P5). Each assertion checked against the real filesystem after
  a sweep, not the pure return value — including P5 (a hardener inside its
  own tolerance is not surfaced), which the coder's evidence notes only
  becomes non-vacuous once tolerance resolution is keyed per-role rather
  than by a single collapsed base value.
- `bb swarmforge/scripts/test/batch_claim_progress_lib_test_runner.bb`: ok.
- `bb swarmforge/scripts/test/batch_claim_progress_sweep_test_runner.bb`: ok.
- `bb swarmforge/scripts/test/bl678_batch_claim_progress_invariants_property_runner.bb`:
  ok — confirms BL-678's own property runner (explicitly passing `false` for
  `worktree-dirty?`) still holds against the retired-arity change, matching
  the architect's exhaustive grep-based consumer sweep.
- `bash swarmforge/scripts/test/test_batch_claim_progress_sidecar.sh`:
  **ALL PASS** (5 checks: sidecar write on claim, refresh on progress,
  silent on fresh, surfaced on stale, retire on complete).
- `bash swarmforge/scripts/test/test_handoffd_chase_sweep_wiring.sh`:
  **ALL PASS** (3 checks: telemetry common field, duties-file reporting,
  concurrent-write non-clobbering). Harmless `backlog_depth_lib: no
  swarm-identity for /tmp/... - falling back to the tracked default conf`
  stderr noise from the fixture's isolated tmp root did not affect the
  PASS results.
- `node specs/pipeline/cli.js` on BL-1076's own acceptance feature:
  **11/11**, independently re-confirming the architect's own reported count.
- Orphaned processes: none (`pgrep -fl 'bb |supervisor' | grep hardender`
  empty). `git status --short`: clean — no code change needed.
- Host load quiet throughout (~1.6-2.1 on this host); no fallback to
  targeted-only verification was required.

## Verdict

Everything BL-1076 touches — the new `role-stale-threshold-ms`/
`resolve-stale-threshold-ms` resolution chain, the new
`:suppressed-visible-work` label, the retired dirt-blind 3-arity, and
`apply-batch-claim-progress-check!`'s new `{:suspects :suppressed}` return
shape — is correctly implemented and already thoroughly tested by the coder
(240-run property suite, 5 declared invariant classes) and independently
confirmed by the architect (exhaustive grep-based consumer sweep of both
changed function names across every `.bb` file, 8 independently re-run
checks, verdict COMPLIANT). No code change needed here either. Forwarding to
documenter.

— By hardender.
