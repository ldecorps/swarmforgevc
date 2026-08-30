# BL-1218 — architect pass, 20260830

Commit reviewed: 58842aa55e (cleaner tip), merged into architect at this pass.

## Scope of parcel diff (7d8b5d7da..HEAD)
- swarmforge/scripts/remote_control_launch_lib.sh (new)
- swarmforge/scripts/swarmforge.sh (single call-site swap)
- swarmforge/scripts/test/test_remote_control_launch_lib.sh (new)
- swarmforge/scripts/test/test_remote_control_launch.sh (scenario 03 added)
- swarmforge/scripts/test/suite-manifest.tsv (both suites registered)
- extension/test/bl1218RemoteControlConfigInvariants.property.test.js (new)
- specs/pipeline/steps/bl1218RemoteControlConfigAtLaunchSteps.js (new) + index.js registration
- backlog/evidence/BL-1218-coder-20260830.md

No extension/src TypeScript touched — dependency-gate has nothing to check
for the host/webview/core boundary on this parcel; ran it anyway against the
changed test file (PASSED, no forbidden edges).

## Checks run
1. **Dependency gate**: `node extension/out/tools/dependency-gate.js
   extension/test/bl1218RemoteControlConfigInvariants.property.test.js` →
   PASSED, no forbidden edges.
2. **Co-change report**: run against remote_control_launch_lib.sh and
   swarmforge.sh. remote_control_launch_lib.sh shows only freq-1 pairings
   (below the freq-3 threshold, no flag). swarmforge.sh shows many
   SUSPECTED COUPLING entries (specs/pipeline/steps/index.js,
   swarm_ensure.bb, prompt_engine_lib.bb, etc.) — this is swarmforge.sh's
   standing hub-file coupling (it is the central orchestration script every
   pipeline-touching ticket brushes), not new coupling introduced by this
   parcel; the parcel's own touch to swarmforge.sh is a 3-line call-site
   swap at the existing decision point.
3. **Invariants review** (ticket declares 3): all three have property-test
   coverage in bl1218RemoteControlConfigInvariants.property.test.js —
   invariant 1 (off strips whatever the window line says), invariant 3 (on
   composes byte-identical to the legacy rule + non-Claude untouched), and
   invariant 2 (persisted script never disagrees with the config that wrote
   it, driven against the REAL swarmforge.sh under zsh). Ran
   `npm run test:properties -- bl1218`: 4/4 green.
   - **Non-vacuity re-verified by hand**: temporarily replaced
     `rc_strip_remote_control_flag "$rc_cli"` with a passthrough
     (`printf '%s' "$rc_cli"`) in remote_control_launch_lib.sh and re-ran —
     2 of 4 property tests failed as expected (invariant 1 and invariant 2,
     the ones that exercise stripping). Restored the file; `git status`
     confirms no diff and the suite is back to 4/4 green.
4. **Acceptance**: `node specs/pipeline/cli.js
   specs/features/BL-1218-config-off-is-honored-over-an-explicit-window-flag.feature`
   → 7/7 scenarios pass (Scenario Outline's 4 rows + 3 scenarios). Scenario
   03 exercises the REAL remote_control_health_lib.bb against the composed
   script, closing the loop with BL-1217's sibling repair half.
5. **Shell suites**: test_remote_control_launch.sh (5/5 PASS) and
   test_remote_control_launch_lib.sh (11/11 PASS), both registered as
   `standing` in suite-manifest.tsv.
6. **Constraints check**: absent config confirmed byte-identical to today
   (invariant 3 property + scenario 02); non-Claude seats untouched
   (invariant 3 property + scenario 04); config-on path unchanged
   (invariant 3 property).

## Architecture boundary checks
- Two-layer boundary: unaffected — this is a launch-script composition
  change inside swarmforge.sh/its new lib, no VS Code extension host/webview
  code touched.
- No agent process spawned directly from TypeScript — n/a, no TS touched.
- No browser storage / secrets concerns — n/a.
- Integrate-not-fork: swarmforge.sh is this project's own maintained
  driver script (not SwarmForge upstream source) — in scope for the
  extension repo per local-engineering.prompt's fork note; correctly edited
  here, not copied/duplicated.

## Full-repo out-of-parcel failures
None encountered — no red test, no forbidden edge, no failing script
surfaced outside this parcel's own diff during this pass.

## Verdict
COMPLIANT. No architecture violation, no invariant violation, no
correctness defect spotted. Forwarded to hardender.
