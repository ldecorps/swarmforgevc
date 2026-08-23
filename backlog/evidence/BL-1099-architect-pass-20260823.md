# BL-1099 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner tip `54ab5bbf3c` (BL-1099/BL-1087 cleanup commit; BL-1099
lineage from coder `47f5ac50b`) after merge into the architect worktree
(`a978bfd6f`). Parcel task name is BL-1099 only.

## Scope

Retire BL-303 scenario 02 (give-up cooldown outline with `pid: null` fixture)
and its orphaned unscoped step registrations. Keep supervisor-recovery-01
(healthy-uptime reset). Coverage of the four (elapsed × process-state) cells
stays with BL-1088. Pure helpers live in
`specs/pipeline/scripts/bl1099GiveUpCooldownRetirement.js`; acceptance steps
in `bl1099GiveUpCooldownRetirementSteps.js` (registered in
`specs/pipeline/steps/index.js`). No `extension/src/**` production change for
this ticket.

## Architecture

- Integrate-not-fork: acceptance drives the existing Babashka give-up recovery
  runner; no SwarmForge fork/copy for the extension surface.
- No webview / extension-host I/O boundary / browser storage / secrets touched
  by BL-1099 paths.
- Dependency direction: steps and tests depend inward on the pure helper
  module; policy/proof logic is not tangled with VS Code API.

## Required hard gate: `dependency-gate.js`

Parcel extension tests (from `extension/`):

    Dependency-rule gate PASSED: no forbidden edges.

Fuller scan that also pulls compiled `out/tools/**` still reports the standing
`acyclic` cycle:

    telegram-front-desk-bot.js -> telegramCursorOperatorExec.js
    telegram-front-desk-bot.js -> telegramCursorOperatorLiveness.js
    telegramCursorOperatorExec.js -> telegramCursorOperatorLiveness.js

Tracked as `backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`
(`grep -rl telegramCursorOperator backlog/` / `BL-759`). Not introduced by
this parcel; none of BL-1099's files sit on either side of the cycle.

## Co-change (`co-change-report.js`)

BL-1099 helpers/tests/feature co-change with each other below the suspect
threshold (max frequency 2). One-off co-change with `namedPackConfDrift*` /
`bl1087QwenCodeDocDriftSteps.js` is the cleaner's multi-ticket cleanup commit
— informational batch coupling, not a new architectural edge for BL-1099.

## Invariants review (BL-654/BL-633)

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Retiring removes no coverage for every (elapsed × process state) cell | `bl1099GiveUpCooldownRetirement.property.test.js` invariant 1 (non-vacuity claimed: break `findScenarioCoveringCase` → RED) | Property suite green (2/2). On-disk `missingCoverageCases(all features)` → `[]`. |
| 2 | No BL-303 `registry.define` outlives its scenario | same file invariant 2 (non-vacuity claimed: break `orphanedRegistrations` → RED) | Property suite green. On-disk `orphanedRegistrations(handler, all features)` → `[]`. BL-303 feature retains only the healthy-uptime scenario. |

No `invariant-unencoded` item. No vacuous encoding found from the recorded
break-then-restore notes plus green `test:properties` run.

## Property-testing support (undeclared)

Touched pure module already carries both declared-invariant properties.
`listScenarios` / `expandAlternationFragments` are example-covered in the
unit file; no additional undeclared property manufactured.

## Correctness read

BL-303 feature on disk has one scenario (healthy-uptime). Retired outline
text absent. BL-1088 still carries not-elapsed × {dead, still alive} and
elapsed re-arm wording the coverage matcher accepts. Step `index.js`
registers `bl1099GiveUpCooldownRetirementSteps`. No correctness defect
spotted in the parcel.

## Inventory

NONE.

Forward commit: this evidence commit (not the bare received hash — BL-536).
