# BL-964: Retired `SWARMFORGE_ENSURE_*` Env-Var Regression Gate

A standing gate fails loud when a retired `SWARMFORGE_ENSURE_*` env-var
name reappears in test code, so a fake exported under the wrong spelling
can never again be silently ignored while the real extension bounce runs.

**Last Updated:** 2026-08-20

## Background

`swarm_ensure.bb` reads `SWARM_ENSURE_EXTENSION_CHECK_CMD` /
`SWARM_ENSURE_EXTENSION_BOUNCE_CMD` / `SWARM_ENSURE_SUPERVISOR_CMD`. On
2026-08-20 several test paths exported fake check/bounce/supervisor
scripts under the WRONG names — the retired
`SWARMFORGE_ENSURE_EXTENSION_CHECK` / `_EXTENSION_BOUNCE` / `_SUPERVISOR`
prefix. `swarm_ensure.bb` never reads those names, so the fakes were
ignored and the REAL extension bounce ran: two VS Code Extension
Development Host windows opened unprompted from test runs. The failure is
soft — the test itself still passes — which is what makes it able to
recur silently. The human hotfixed every copy that day (landed on `main`
as `596098dc3`); this gate is what stops the class from coming back.

## How It Works

### The needle set is derived, not hand-written

`extension/test/helpers/retiredEnsureEnvVarGuard.js` is the one place
allowed to spell the retired literals — it lives outside both guarded
directories. Its needle list started as the three names the 2026-08-20
incident happened to expose, but `swarm_ensure.bb` actually reads
**eleven** `SWARM_ENSURE_*` seams (`BABYSITTERD_CMD`, `CURSOR_BRIDGE_CMD`,
`EXTENSION_BOUNCE_CMD`, `EXTENSION_CHECK_CMD`, `FRONT_DESK_CMD`,
`OPERATOR_CMD`, `RC_CAPTURE_CMD`, `RC_CMDLINE_CMD`, `RC_NOTIFY_CMD`,
`RC_SESSION_DEAD_WAIT_SECONDS`, `SUPERVISOR_CMD`) — a hand-written roster
of three covered 3 of 11, and 8 of 9 retired spellings outside the
original incident went unflagged, each carrying the identical silent
failure.

`deriveRetiredEnsureEnvVars` reads `swarm_ensure.bb`'s own source, matches
every `SWARM_ENSURE_[A-Z_]+` literal, and maps each to its retired form
(`retiredSpellingOf`: drop the `SWARM_` and trailing `_CMD`, prefix
`SWARMFORGE_ENSURE_`) — the same read-the-other-side's-literal method
BL-948's parity test uses. A twelfth seam is covered the day it is added,
with no edit to this file. Two safety properties:

- **union with the historical floor** (`RETIRED_ENSURE_ENV_VARS`, the
  three incident names) — deriving can extend the gate but never shrink
  it below the names known to have caused a real incident;
- **an empty derivation throws** rather than yielding an empty needle
  set, which would make the gate pass every file while looking green —
  the one failure a gate must never have.

### The needles are full names, never a bare prefix

`main` legitimately carries two explanatory comment mentions of the bare
`SWARMFORGE_ENSURE_*` prefix (`test_swarm_ensure.sh` and a BL-571 step
file). A bare-prefix grep would trip on prose; the needles are the FULL
retired names, so those comments are never flagged.

### Trap-resistance: the gate's own step handlers can't carry the literal

`specs/pipeline/steps/bl964RetiredEnsureEnvVarGateSteps.js` lives inside
one of the two guarded directories, so it builds the retired names from
split parts (`'SWARMFORGE_' + 'ENSURE_' + suffix`) at runtime rather than
spelling them — otherwise the gate's own acceptance fixture would trip
its own scan.

### Where it is enforced

`extension/test/retiredEnsureEnvVarGuard.test.js` runs
`scanTreeForRetiredEnsureVars` over `specs/pipeline/steps/` and
`swarmforge/scripts/test/` — the two directories the operator directive
named — as part of the standing suite every parcel runs (`npm test`,
`vitest.config.mjs`), the same shape as BL-948's
`socketFixtureShortRootGuard.test.js`. The acceptance feature
(`specs/features/BL-964-wrong-prefix-ensure-env-var-regression-gate.feature`)
covers three retired-name/directory combinations plus the clean-tree case
under the BL-113 Gherkin-mutation gate.

## Known Not Covered

- Only the two directories the operator directive named are scanned. No
  other test path today exports ensure fakes, so widening the scan would
  guard nothing yet — if `extension/test/` (or elsewhere) ever starts
  exporting ensure fakes, the scan needs to widen with it.
- One class, one gate: this does not generalize to other env-var
  families. A second incident class would need its own gate.

## Human-Facing Surface

None. This closes a defect in the test harness itself — no extension
command, setting, or UI changes, and no `.bb` file was modified.
