# BL-1318 architect pass — 2026-09-01

Reviewed commit: 0e0740b5bd (cleaner), merged into architect at
584af3d79a..HEAD (merge commit follows this evidence).

## Dependency gate (BL-259, hard gate)

Scoped invocation (`../specs/pipeline/steps/bl1318PackStaffingGateSteps.js
../specs/pipeline/steps/index.js`) reports the same known scoped-subset
artifact prior passes have already logged:

```
../specs/pipeline/steps/bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps.js -> ../specs/pipeline/steps/index.js violates "acyclic"
```

Not introduced by this parcel — grepped and confirmed already tracked
(BL-726, BL-1213, BL-1189, BL-1237, BL-1295, BL-1313 evidence all hit and
dismissed the identical scoped-subset report). Full-repo scan
(`node out/tools/dependency-gate.js`, no args, authoritative per the bl259
invocation note) is clean: **PASSED, no forbidden edges.**

## Co-change report (BL-255)

Ran against all 34 non-backlog files this parcel touched. Every reported
pair sits at frequency 1 (this is the first and only commit touching this
set together) — below the default threshold of 3. No suspected coupling
flagged.

## required_wiring — both anchors verified live

- `swarmforge/scripts/swarmforge.sh::pack_staffing_gate` — single call site
  at `parse_config`'s per-window loop (line 888), immediately after
  `validate_agent` (line 850ish). Confirmed by grep: only one call site in
  the file. Covers the mono-router `@`-seat rotate path too (same
  `seat_stage` variable feeds both `validate_agent` and the new gate).
- `swarmforge/scripts/pack_staffing_gate_lib.bb::seat-staffing-decision` —
  the one pure rule; both the shell gate (via `pack_staffing_gate_cli.bb`)
  and every test (unit, property, wiring, acceptance) drive this exact fn.

## Invariants review (BL-633/654) — all three declared, all encoded non-vacuously

Property runner `bl1318_pack_staffing_gate_property_runner.bb` (400 draws,
generator floors 15/shape, all 6 shapes hit) encodes all three declared
invariants directly against the pure decision fn:

1. fail-closed/no-default — decision always in {pass,refuse,override};
   unresolved-without-override always refuses. Verified non-vacuous by
   reading the assertions against each of the 6 constructed shapes.
2. reads-only — before/after `=` on the evidence map every draw, plus a
   same-input determinism check (a mutating impl could drift on repeat
   call). Also re-verified at the launch level: the acceptance scenario
   "gate reads steward evidence and never writes or captures it" snapshots
   the real fixture state dir byte-for-byte before/after a real
   `parse_config` run — this is the strongest form of the check since it
   drives the real CLI + real shell gate, not just the pure fn.
3. override-never-a-pass — every override draw checked to land on
   "override" (if it would have failed) or plain "pass" (if it wouldn't),
   and the two are asserted mutually exclusive.

Ran all four verification layers myself, all green:
- `bb swarmforge/scripts/test/pack_staffing_gate_lib_test_runner.bb` — pass
- `bb swarmforge/scripts/test/bl1318_pack_staffing_gate_property_runner.bb` — 400/400 draws, ALL PROPERTIES HOLD
- `bash swarmforge/scripts/test/test_pack_staffing_gate.sh` — 7/7
- `bash swarmforge/scripts/test/test_pack_staffing_gate_wiring.sh` — 7/7 (incl. @-seat mono-router coverage, 05a/05b)
- `node specs/pipeline/cli.js specs/features/BL-1318-pack-launch-steward-staffing-gate.feature` — 7/7 scenarios pass end-to-end through the real step handlers (real swarmforge.sh sourced, real parse_config run, real pack_staffing_gate_cli.bb)

## Human ruling conformance

`PACK_STAFFING_SKIP_GATE=1` env-var-only escape hatch, matching
`ruling_options[0]` exactly. Grepped: no `--override-uncertified` CLI flag
introduced anywhere.

## Architecture

Pure lib (`pack_staffing_gate_lib.bb`, no IO) + thin fs-adapter CLI
(`pack_staffing_gate_cli.bb`, reads registry/scorecards only, never writes)
+ thin shell caller (`pack_staffing_gate` in `swarmforge.sh`) — matches the
required split and the same shape as the BL-1127 precedent
(`local_coder_battery_staffing_gate.sh`). The 26 unrelated
`test_*.sh` fixtures that gained a one-line `PACK_STAFFING_SKIP_GATE=1`
export are all pre-existing `parse_config` fixtures using placeholder
`--model` values unrelated to steward staffing — each spot-checked, correct
and consistent (the two staffing-gate test files themselves correctly do
NOT get the bypass, since they test the gate).

## Acceptance step handler registration

`bl1318PackStaffingGateSteps` required and present in
`specs/pipeline/steps/index.js:915` in the same commit as the handler
(BL-233 contract). Scenario Outline handler validates against explicit
`STANDINGS`/`KNOWN_FAILING_CHECKS` closed sets — no passthrough.

## Property-testing pass (undeclared properties)

No additional pure/testable module beyond what the coder's declared-
invariant property test already covers was touched by this parcel;
`pack_staffing_gate_cli.bb` and `swarmforge.sh` are IO/shell, outside the
property-testing boundary. No additional property test needed.

## Verdict

Architecturally compliant, all three declared invariants correctly and
non-vacuously encoded, both required_wiring anchors live-verified, human
ruling followed exactly. No correctness defect spotted. Forwarding to
hardener.
