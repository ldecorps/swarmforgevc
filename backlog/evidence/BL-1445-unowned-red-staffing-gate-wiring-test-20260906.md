# BL-1445: unowned red — test_pack_staffing_gate_wiring.sh case 01 (specifier, 2026-09-06)

Trigger: coder `note`, priority 00, 2026-09-06T17:22:54Z, from the BL-1437
parcel: "unowned-red test_pack_staffing_gate_wiring.sh case 01 fails on
main HEAD". Coder evidence: `backlog/evidence/BL-1437-coder-pass-20260906.md`,
"A standing red found, unrelated" (reproduced on a clean clone of main at
59337764a2, before any BL-1437 edit). Handled under the standing-red rule
(2026-09-05): owner minted at severity high the same pass, register row
added.

## Reproduction on main at 00372da7f0 (specifier pane)

`bash swarmforge/scripts/test/test_pack_staffing_gate_wiring.sh`:

```
FAIL: 01: an uncleared seat (cursor/nightly, no steward mapping) should have refused parse_config
```

Case 01's captured output (re-run with `$OUT1` printed):

```
WARNING: pack staffing gate OVERRIDE (PACK_STAFFING_SKIP_GATE=1) — role 'QA' staffed with window line 'cursor --model nightly' despite failing check 'seat-model-unresolved'. Clear it: <no runnable command>
PARSE_CONFIG_RETURNED
```

Same file, override removed from the environment:

```
env -u PACK_STAFFING_SKIP_GATE bash swarmforge/scripts/test/test_pack_staffing_gate_wiring.sh
...
test_pack_staffing_gate_wiring: ALL CHECKS PASSED
```

Controls: `test_pack_staffing_gate.sh` (CLI fs-adapter) ALL CHECKS PASSED;
`pack_staffing_gate_lib_test_runner.bb` all assertions passed;
`test_backlog_depth_pack_override.sh` ALL PASS (it prints the same OVERRIDE
warning and asserts nothing about the gate).

## Mechanism

`.swarmforge/swarm.env` line 46 (gitignored launch environment):
`export PACK_STAFFING_SKIP_GATE="${PACK_STAFFING_SKIP_GATE:-1}"` - the
documented operator escape hatch, present because the full-forge pack has a
seat `pack_staffing_gate_lib.bb` cannot resolve (BL-1437). Every role pane,
and so every suite run inside the swarm, inherits it. The wiring test's
cases set `MODEL_STEWARD_STATE_DIR` per invocation but never decide
`PACK_STAFFING_SKIP_GATE`; `swarmforge.sh`'s `pack_staffing_gate` (554-608)
reads it and turns the expected refusal into a warning, so `parse_config`
returns and case 01's `RC1 -ne 0` fails. The test is `set -euo pipefail`
with `fail` exiting, so cases 02-05b never run. The gate itself is intact.

## Disposition

Owner: BL-1445 (new, `type: defect`, `severity: high`, epic
swarm-intelligence-layer - BL-1318's). Not BL-1437: that ticket certifies
the art-director seat and never touches this test; it matched only on
keywords. Not the hardender's 2026-08-12 rule as written: that rule is
scoped to `SWARMFORGE_*` names, and this variable is outside the prefix -
its text was widened with this mint. Register row: lane `shell`, file
`swarmforge/scripts/test/test_pack_staffing_gate_wiring.sh`, ticket
BL-1445, first_seen 2026-09-06 (first recorded).
