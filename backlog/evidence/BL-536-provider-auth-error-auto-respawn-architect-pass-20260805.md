# BL-536 — architect PASS (re-entry after QA bounce for missing arch+hardener stages)

**Verdict:** PASS → forward to hardender. QA's bounce (`da17348c12`, evidence
`BL-536-provider-auth-error-auto-respawn-bounce-20260805.md`) correctly found
this ticket's ancestry jumped coder → cleaner → documenter with no
architect-authored commit; this is that missing pass, run against the same
commit QA identified (coder `da83fb6a`, cleaner merge `12ec1b62`).

## Architecture (two-layer boundary, module boundaries)

- This ticket touches only `swarmforge/scripts/*.bb` (daemon-side swarm
  machinery) plus JS acceptance step handlers — no `extension/src` files. The
  extension's tile-vs-substrate / webview-vs-host-IO boundaries do not apply;
  `swarmforge/` is the maintained fork this project deliberately modifies
  (Local Engineering Architecture Rule 2).
- `provider_respawn_env_lib.bb` is an exact extraction of
  `swarm_ensure.bb`'s `provider-respawn-env-args` (diffed byte-for-byte
  against the removed block) with `state-dir` threaded explicitly instead of
  a bound global — deliberate, so a second caller (`handoffd.bb`, a
  long-running daemon) can reuse it without `load-file`'ing `swarm_ensure.bb`
  itself, which unconditionally runs `-main` (a full ensure sweep +
  `System/exit`) as a load side effect. `swarm_ensure.bb`'s own call site now
  delegates with arity/behavior unchanged — confirmed by reading the diff,
  not assumed.
- `handoffd.bb`'s new `do-auth-respawn!` mirrors the existing `do-respawn!`
  busy-precheck shape exactly (same `actively-processing?` guard, same
  launch-script path, same `respawn-pane -k` invocation) — no new pattern
  introduced for an already-solved problem.
- Dependency-gate hard gate (BL-259): not applicable — no changed file falls
  under `extension/.dependency-cruiser.cjs`'s scope. Ran a full-repo scan
  anyway (`cd extension && node out/tools/dependency-gate.js`); the one
  reported violation (`telegram-front-desk-bot.ts` acyclic cycle) touches
  none of this ticket's files and is already tracked as
  `backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml` —
  pre-existing, not introduced here.
- Co-change report: dominated by `handoffd.bb` being an existing high-churn
  hub file (co-changes with dozens of unrelated test files at low frequency);
  no suspicious coupling specific to this ticket's new modules
  (`provider_auth_observe_lib.bb`, `provider_respawn_env_lib.bb`).

## Invariants (BL-654) — both declared, both non-vacuously tested

1. "Respawn attempts per role bounded by the configured attempt cap across
   ALL observe ticks" — `provider_auth_observe_lib_property_runner.bb` P1,
   500 runs, break-then-fix documented (widening the `<` guard to `<=`
   surfaced the violation immediately). Re-ran myself: `ALL PROPERTIES HOLD`,
   generator coverage 568 under-cap / 691 at-or-past-cap ticks — both sides
   of the cap genuinely exercised, not just theoretically reachable.
2. "Once the cap is reached, further ticks are quiet (no more respawns, no
   duplicate alerts)" — same runner, P2, break-then-fix documented (dropping
   the `not alerted` guard surfaced immediate over-alerting). Re-ran myself:
   holds.

## Correctness — re-ran QA's evidence independently, not trusted on faith

- `provider_auth_observe_lib_test_runner.bb`: PASS.
- `provider_auth_observe_lib_property_runner.bb`: ALL PROPERTIES HOLD (500
  runs).
- `test_handoffd_auth_observe_wiring.sh`: 3/3 PASS (real daemon chase-sweep
  reaches the new path against a fake-tmux fixture, with real provider-compat
  env args, real force-relaunch).
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-536-provider-auth-error-auto-respawn.feature`: 3/3 PASS.
- No correctness defect spotted in the reviewed diff.

## Handoff

Forwarding to **hardender** (QA's D2: hardener pass is also missing entirely
for this ticket) with the same task name and QA's approved commit as the
carried lineage.
