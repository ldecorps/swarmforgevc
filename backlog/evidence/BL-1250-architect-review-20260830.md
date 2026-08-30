# BL-1250 — architect design review, 2026-08-30

Reviewed commit `cb16e27f6` (coder), merged via cleaner (`39fe9387a`) into
architect as `43a59a2f2`.

## Constraints checked against the diff directly

- `expected-live-set` still declares `:role-agents 8` — not changed to 16
  to paper over the defect (grepped, unchanged).
- `live-set-delta` itself untouched — still reports a delta, never asserts
  health.
- `tmux-servers-answering` and the handoffd probes are byte-for-byte
  untouched (diffed the file: only `probe-liveness`'s `:role-agents` line
  changed in `expedite_cli.bb`, plus the new `ps-entries-matching`/
  `argvs-matching` helpers).
- The needle stays root-scoped: `launch-files-by-role`'s pattern is built
  from `(str root launch-dir-segment)`, and BL-782's own 8-scenario
  acceptance suite (below) still passes, including its
  foreign-root-not-counted scenario.
- No socket-glob liveness reintroduced — `tmux-servers-answering` untouched.

## The fix itself

Counts DISTINCT ROLE NAMES extracted from the launch-dir-scoped argv, not
processes — independent of how many processes a role happens to run.
`launcher-only?` correctly treats a role named only by its own `<role>.sh`
as SHORT (not agent-up), which is the harder direction: a naive "count
distinct role names present" would hide a real half-launch (the launcher
outlives its dead agent child), and the code and its property runner both
specifically test this (`P2`, `some-dead`/`all-dead`/`wrapper-role`
coverage).

## Invariant

"A fully healthy pack of N roles is observed as exactly N role agents...
never changes with the number of processes a single role runs" —
property-tested with per-role process arity drawn 1..5 independently per
role (not uniformly, which the commit message correctly notes would be
unable to distinguish "counts roles" from "divides by a constant"), over
pack sizes 1..12. Coverage includes `wrapper-role` (a role with 3+
processes) and `single-process-role`, both exercised (376 and 266 draws).
Non-vacuity claims verified by reading the runner: P1 (processes-not-roles)
and P2 (k dead agents => short by exactly k) are two independent
assertions, so a probe that always returns the expected count cannot
silently satisfy both.

## Runs (reproduced during this review)

- `bb swarmforge/scripts/test/expedite_lib_test_runner.bb` — ALL PASS.
- `bb swarmforge/scripts/test/bl1250_role_agent_count_property_runner.bb` —
  ALL PASS, 400 runs/invariant, coverage over all nine named shapes.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1250-expeditor-role-agent-probe-counts-roles.feature` —
  7/7, driving the real `--probe-liveness` over real decoy processes (no
  swarm launched).
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-782-liveness-probes-scan-whole-process-table.feature`
  (named regression) — 8/8.
- `bash swarmforge/scripts/test/test_expedite_cli.sh` (named regression) —
  ALL PASS.
- `node extension/out/tools/co-change-report.js
  swarmforge/scripts/expedite_lib.bb swarmforge/scripts/expedite_cli.bb` —
  ordinary, already-updated companions only. No action.
- No `required_wiring:` declared on this ticket — n/a.

## Disposition

No defect found. Forwarded to hardender.
