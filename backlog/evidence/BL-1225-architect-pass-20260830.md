# BL-1225 — architect pass, 2026-08-30

Reviewed commit `0dfdaf91e` (coder), merged into architect at `b71f0b332`.

## Boundary / architecture checks
- Pure `.bb` script change (`build_freshness_cli.bb`, `build_freshness_lib.bb`)
  plus its own unit runner, an acceptance feature/step pair, and a property
  test. No `extension/src` files touched — the two-layer host/webview
  boundary, webview storage restriction, and secrets-in-host-only rule do not
  apply to this parcel.
- `node extension/out/tools/dependency-gate.js` (full-repo, no args): PASSED,
  no forbidden edges.
- `node extension/out/tools/co-change-report.js` against the three changed
  `.bb` files: only the expected siblings (`build_freshness_cli.bb` <->
  `build_freshness_lib.bb` <-> its test runner <-> `steps/index.js`) show as
  SUSPECTED COUPLING — all already co-committed in this same parcel. No
  surprising coupling.
- Constraints honored: which groups a sync restarts, and their order, is
  untouched; BL-433's stop-file, `status.json` deletion, and bounded
  settle-wait are byte-for-byte unchanged (diff confirmed no touch to those
  lines).
- `:extra-env` for setting `SWARMFORGE_DAEMON_START_CALLER` matches the
  established idiom used elsewhere in this codebase (onboarder_supervisor.bb,
  salvage_lib.bb, front_desk_supervisor.bb, etc.) rather than inventing a new
  pattern.

## Invariants review (BL-633/654)
Both declared invariants have non-vacuous property tests in
`extension/test/bl1225SyncRestartTrailInvariants.property.test.js`, driving
the real production opts map and the real `start_handoff_daemon.sh`:
- `npm run test:properties` (scoped to bl1225): 3/3 pass.
- `bb swarmforge/scripts/test/build_freshness_lib_test_runner.bb`: ALL TESTS
  PASSED, including the required_wiring assertions.
- `node specs/pipeline/cli.js specs/features/BL-1225-...feature`: 3/3
  scenarios pass, driving real production artefacts per the handler header.

## Pre-existing red (not this parcel's)
`swarmforge/scripts/test/test_build_freshness_cli.sh` fails at
`02/03(compiled): bridge should be reported stale before sync`. Reproduced
independently on the merged tree. Already surfaced as pre-existing/unrelated
in `backlog/evidence/BL-1277-qa-pass-20260830.md` (same failure signature,
same day) — not re-reported or re-ticketed here.

## Verdict
No architecture violation, no invariant violation, no correctness defect
spotted. Forwarded to hardener.

By architect.
