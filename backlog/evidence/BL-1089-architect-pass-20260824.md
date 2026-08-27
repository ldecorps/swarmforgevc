# BL-1089 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner tip `fca2378083` (fast-forward into architect worktree).
Lineage: `314ae2ca88` (coder, fixture repair + property/APS cover) +
`fca2378083` (cleaner, DRY `drive_until_gave_up` + shared
`pollHeartbeatStale` bb seam). No prior QA/architect bounce on this ticket
(fresher `main` ahead of `origin/main`; grep of `.swarmforge/bounces` and
evidence for BL-1089 bounce: empty).

## Scope

Repair `test_front_desk_supervisor_liveness.sh` so "stopped listening" is
modeled as an after-spawn age-0 heartbeat aged past `FRONT_DESK_STALL_MS`,
not a 5000ms backdate that predates spawn (BL-1035 own-heartbeat guard).
Pins BL-370 cascade + BL-1035 predecessor-in-grace end-to-end. APS steps
`bl1089FrontDeskLivenessSuiteSteps.js` + shared adapter
`specs/pipeline/steps/lib/pollHeartbeatStale.js`; property file
`bl1089FrontDeskLivenessFixture.property.test.js`.

Explicitly OUT of scope and untouched in the BL-1089 commit range:
`front_desk_supervisor.bb`, `front_desk_supervisor_lib.bb`.

## Architecture

- Integrate-not-fork: test + APS adapter drive the maintained
  `swarmforge/scripts/` supervisor; no TypeScript spawn bypass of tmux.
- No `extension/src/**` production surface; no webview; no browser storage;
  no secrets written into a target tree.
- Policy stays in babashka (`poll-heartbeat-stale?`); the JS adapter is a thin
  `execFileSync` seam for steps/properties — dependency points inward to the
  lib, does not reimplement stall policy in TypeScript.

## Required hard gate: dependency-gate.js

Parcel straddles `extension/test/`, `specs/`, and `swarmforge/scripts/test/`.
Per-parcel scan of the extension test file: **PASSED**.

Full-repo scan (`node out/tools/dependency-gate.js`, no args):

    Dependency-rule gate FAILED:
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorExec.ts violates "acyclic"
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"
      src/tools/telegramCursorOperatorExec.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"

Pre-existing, tracked as `BL-759`
(`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`).
Parcel files are none of those three. Not re-reported (BL-759 / BL-1063).

## Co-change

`test_front_desk_supervisor_liveness.sh` flags expected historical partners
(`test_front_desk_supervisor_tick.sh`, `front_desk_supervisor.bb`,
`specs/pipeline/steps/index.js`) as SUSPECTED COUPLING — informational;
judged non-actionable for this fixture-only repair. New property/steps/lib
files co-change with each other only (parcel-local).

## Invariants (both declared)

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Suite goes RED if BL-1035 own-heartbeat guard or BL-370 stall detection regresses; no green-by-widening-grace / zeroing grace / asserting less | `bl1089FrontDeskLivenessFixture.property.test.js` inv1 + fixture source contract + live suite | Green; non-vacuity below |
| 2 | Every "served" heartbeat stamp is after that child's spawn | age-0 helper + source assert (`write_heartbeat "$root" 0`, no `write_heartbeat "$F" 5000` on stall paths) | Green; non-vacuity below |

Non-vacuity (empirical, this pass):

1. Fixture helper age `0` → `5000`: property source test RED
   (`helper must stamp age 0`); restored; 3/3 green; `git diff` clean.
2. Adapter stubbed to ignore own-heartbeat/spawn (3-arity-shaped
   `now - hb >= stall`): inv1 RED
   (`predecessor heartbeat inside grace must not stall`); restored; 3/3
   green; `git diff` clean.

## Property-testing pass (undeclared)

Touched pure surface is the shared `pollHeartbeatStale` adapter and the
fixture contract already covered by the two declared-invariant properties
plus the source inspection test. No additional undeclared property
warranted; none manufactured. `npx vitest run --config
vitest.properties.config.mjs bl1089FrontDeskLivenessFixture` → 3 passed.

## Correctness read-through

- Fixture uses `stamp_own_heartbeat_then_age_past_stall` (age 0 + sleep past
  stall); predecessor-in-grace check uses explicit 60000ms backdate and
  expects `running`. Stall/grace env knobs and assertion labels for the
  BL-370 cascade are preserved (not emptied).
- Live suite this pass: **ALL CHECKS PASSED** (14 ok lines including
  liveness-01..05 cascade).
- Cleaner DRY (`drive_until_gave_up`, shared adapter) is behavior-preserving
  structure only — no architecture boundary change.

## Inventory

**NONE**

## Verdict

Pass to hardender.
