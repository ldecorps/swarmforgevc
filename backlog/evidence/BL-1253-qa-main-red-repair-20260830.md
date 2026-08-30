# BL-1253 — QA repair of a partial-resurrection main-red, 2026-08-30

Not a bounce. This is a QA-exclusive infrastructure repair (`specs/pipeline/steps/`
is QA-only on `main`, `check_pipeline_code_on_main.sh`), triggered by a `note`
from the specifier: "main red: BL-1253 handler unregistered, full parcel at
2e519c4a8f".

## Root cause

QA's earlier bounce of BL-1253 (`207dc0c03b`, scenario 06 missing a handler)
was correctly reverted out of the QA branch (`403b75e44e`, per BL-490/BL-495).
Separately, the coder reworked the ticket (scenario 06 added) and the full
pipeline re-ran (evidence: `BL-1253-coder-rework-scenario06-strand-20260830.md`,
`BL-1253-architect-pass-2-20260830.md`, `BL-1253-hardener-pass-2-20260830.md`),
but the ticket was parked to `hold/` mid-flight (`66be60ea40`, orphaned by a
dead expedite run for BL-1295) before a fresh QA verification landed it.

Today's repo-wide consolidation commit `2e519c4a8f` ("Initial swarmforge
repository") carries the complete, already-fixed BL-1253 acceptance parcel as
inherited tree content (confirmed on all `primary/*` branches plus `main`),
but the resurrection was **partial**: the step handler file and most of the
feature file came back; the `index.js` registration line, the
`bl1253StartCursorBridgeFeederCli.sh` lib script, and the feature file's
mutation-stamp header did not.

## Verification before repair

```
node specs/pipeline/cli.js specs/features/BL-1253-swarm-stamp-dead-feeder-owns-getupdates-2ec06b6ef1.feature
```
Commit tested: working tree at parent `7907dc6c40` (pre-repair).
Result: 8 tests, 0 pass, 8 fail — `no step handler matched "Given the landed
sources at commit 2ec06b6ef1"` (and identically for every other step in the
file, since the module was never `require`d).

Confirmed the step handler file itself already implements scenario 06
(`grep -n "scoped(" specs/pipeline/steps/bl1253DeadFeederOwnsGetUpdatesStampSteps.js`
shows patterns for "the bridge owns getUpdates because the heartbeat was
stale" / "the front-desk poll heartbeat becomes fresh again during the run" /
"the bridge returns to consuming the queue without being restarted") — this
is the post-bounce, post-rework version, byte-identical to the copy at
`2e519c4a8f`. Nothing here re-opens the original bounce.

## Repair

Restored from `2e519c4a8f` (diffed field-by-field against the working tree,
not blind-copied):
1. `specs/pipeline/steps/index.js` — re-added
   `require('./bl1253DeadFeederOwnsGetUpdatesStampSteps'),` at its original
   position (between the `bl1250` and `bl1224` entries). Confirmed exactly
   one occurrence after the edit, `index.js` still `require()`s cleanly.
2. `specs/pipeline/steps/lib/bl1253StartCursorBridgeFeederCli.sh` — file was
   fully absent; restored verbatim (85 lines) and re-marked executable.
3. `specs/features/BL-1253-swarm-stamp-dead-feeder-owns-getupdates-2ec06b6ef1.feature`
   — restored the 5-line mutation-stamp header (hardener's real recorded
   mutation-kill data for the Scenario Outline, `Killed: 6/6`) that the
   partial resurrection dropped. No scenario text changed.

## Verification after repair

```
bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1253-swarm-stamp-dead-feeder-owns-getupdates-2ec06b6ef1.feature
```
Result: `1..8 / # pass 8 / # fail 0`. All 8 scenarios pass, including
scenario 06.

No orphaned `node --test`/`stryker` processes before or after
(`pgrep -fl 'node --test|stryker'` empty both times).

Not run: the extension's full Vitest unit suite — this repair touches only
`specs/pipeline/steps/` and `specs/features/`, not `extension/src` or
`extension/test`, and is not a ticket-gate verification pass (BL-1253 stays
`status: todo`, `assigned_to: coder`, parked in `backlog/hold/` — this repair
does not close it or change its assignment; that remains the specifier/
coordinator's call on unparking).

Checked for interaction with the known standing defect
[[bl1277-step-collision-count-is-15-not-12]] (unscoped `registry.define`
collisions in this same registry): the restored handler uses `scoped()`
exclusively, not raw `registry.define`, so it is outside that already-ticketed
class. Not re-diagnosed or fixed here.

## Disposition

Landing this restoration directly on `main` (QA-exclusive path,
`SWARMFORGE_ROLE=QA`). Notifying the specifier that main is repaired, with
the landing commit hash. BL-1253 itself is untouched — still parked, still
needs a human/specifier call on unparking and routing the (apparently
already-complete) rework through a fresh QA verification pass proper.
