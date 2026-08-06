# BL-823 — architect pass, 2026-08-06

Reviewed commit: `565c70a6d0` (BL-823: append-only swarm availability
interval ledger), received via cleaner's merge `77072e7010` into this
worktree (merge commit `a5828b19`).

Parcel scope (isolated via `git log --oneline 2ccb3a09..565c70a6` and the
commit's own diff — the wider merge also carried unrelated already-landed
history from other tickets, not reviewed again here): 23 files, 1598
insertions — TS write side, shell write side, Babashka reader, four
required wiring points, three property tests, one feature file (8
scenarios), step handlers.

## Dependency-rule gate (Article 1.5 REQUIRED HARD GATE, BL-259)

`node extension/out/tools/dependency-gate.js` against the 5 changed
`extension/src/**` files — reports the same pre-existing `acyclic` cycle
already known from BL-814/813/811/622 architect passes and explicitly
ticketed as `backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`:

```
src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorExec.ts
src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorLiveness.ts
src/tools/telegramCursorOperatorExec.ts -> src/tools/telegramCursorOperatorLiveness.ts
```

Confirmed unrelated to this parcel:
- Full-repo scan (no args) reports the identical 3 edges — not something
  the 5 named files uniquely trip.
- `git diff 2ccb3a09 565c70a6 -- extension/src/tools/telegram-front-desk-bot.ts extension/src/tools/telegramCursorOperatorExec.ts`
  filtered to import lines shows exactly one line added in each file:
  `import { appendAvailabilityRecord } from '../metrics/availabilityLedgerStore';`
  — neither of the cycle-forming imports was touched.
- BL-759 explicitly anticipates and rules against bouncing exactly this
  case ("the next parcel that touches any of these three files... a wasted
  round-trip charged to an innocent ticket").

Not a BL-823 send-back item.

## Co-change / logical coupling (BL-255, informational)

`node extension/out/tools/co-change-report.js` on the 5 changed source
files. `telegram-front-desk-bot.ts` shows its already-known large
SUSPECTED COUPLING set (the hottest file in the repo per BL-759's own
notes) — unrelated to this parcel's own additions. The BL-823-specific
files (`availabilityLedgerStore.ts`, `apply-cooldown-pause.ts`,
`resume-expired-pauses.ts`) co-change only with each other, their own
tests, and the shell/bb siblings of this same ticket — expected, not a
coupling concern. `specs/pipeline/steps/index.js` shows the standard
append-only step-registry coupling every acceptance-adding ticket touches
by design (same pattern noted in the BL-622 architect pass).

## Invariants review (BL-633/BL-654)

Ticket declares three invariants; all three carry genuine, non-vacuous
property tests authored by the coder, each driving the REAL production
code (never a JS reimplementation of the fold or the shell writer):

1. "A ledger write failure never blocks, fails, or alters the operation it
   observes" — `availabilityLedgerWriteNeverBlocks.property.test.js`, 3
   properties across `appendAvailabilityRecord` and both TS pause-writer
   twins, forcing a real EISDIR write failure (directory at the exact
   ledger path) — the established non-chmod failure-simulation technique.
2. "The ledger is append-only... the reader tolerates duplicate,
   out-of-order and corrupt lines without ever inventing a record that is
   not there" — `availabilityLedgerReaderTolerance.property.test.js`,
   drives the real `.bb` reader via `bl823_fold_acceptance_runner.bb`
   against a shuffled, duplicated, corrupted record stream; asserts every
   emitted interval's start/end timestamps trace back to a real written
   record.
3. "Every interval the reader emits carries explicit provenance... never
   closed with a guessed timestamp" — `availabilityLedgerReaderProvenance.property.test.js`,
   same real-`.bb`-driving approach; checks provenance BOTH directions
   (inferred implies heartbeat-inferred source, AND heartbeat-inferred
   source implies inferred) — the comment correctly notes a
   one-directional check alone would be vacuous against an
   always-"proven" mutant.

No missing or vacuous property test found. Not an `invariant-unencoded`
item.

## Property testing (undeclared-property pass, architect-owned)

The touched pure/testable modules are exactly `availabilityLedgerStore.ts`
and `availability_ledger_lib.bb` (the fold) — both are already the target
of the three declared-invariant property tests above, which between them
already cover round-trip/idempotence-shaped behavior (append-then-fold,
duplicate tolerance) for these modules. No further property-shaped gap
found on the modules this parcel touched; no additional property test
added.

## Architecture rules checked

- Two-layer boundary (tiles/webview vs tmux substrate): not implicated —
  no VS Code API, webview, or process-spawn code touched.
- Extension host owns I/O: `appendAvailabilityRecord` (fs writes) lives in
  `extension/src/metrics/`, called from extension-host tool code — correct
  layer.
- Webview storage: N/A, no webview code touched.
- Secrets: N/A, no credentials/tokens touched.
- Integrate-not-fork: `swarmforge/scripts/availability_ledger_lib.{bb,sh}`
  additions are within this project's own maintained fork (Local
  Engineering Architecture Rule 2) — the legitimate place for this kind of
  change; SwarmForge upstream itself is untouched.

## Verification run

- `node specs/pipeline/cli.js specs/features/BL-823-availability-interval-ledger.feature`
  → 13/13 subtests pass (all 8 scenarios, including the 3-example and
  3-example outlines).
- `npx vitest run availabilityLedgerStore.test.js applyCooldownPauseCli.test.js resumeExpiredPausesCli.test.js telegramCursorOperatorExec.test.js telegramFrontDeskBotCli.test.js`
  → 294/294 tests pass.
- `npx vitest run --config vitest.properties.config.mjs availabilityLedger`
  → 5/5 property tests pass (3 test files).
- `bb swarmforge/scripts/test/availability_ledger_lib_test_runner.bb` →
  ALL PASS.
- `bash swarmforge/scripts/test/test_availability_ledger_lib.sh` → every
  check prints `ok`/`PASS`, `ALL PASS: availability_ledger_lib.sh`, but the
  script's own exit code is 1. Root cause: the shared
  `swarmforge/scripts/test/lib/tmp_cleanup.sh` EXIT trap hits the
  already-known, already-ticketed bash-3.2 empty-array `unbound variable`
  bug (BL-801, and engineering.prompt's own documented fix,
  `${arr[@]+"${arr[@]}"}`) — confirmed pre-existing:
  `tmp_cleanup.sh` was last touched by `2c4785d7` (BL-459), not by this
  parcel, and BL-823's diff does not touch it. Same class already ruled
  non-blocking in the BL-622 architect pass (`test_launch_front_desk.sh`
  hit the identical trap). Not a BL-823 defect — already tracked under
  BL-801, no new `rule_proposal` needed.
- Required wiring (`required_wiring:` in the ticket YAML) — all four
  confirmed live in the diff: both TS pause twins call
  `appendAvailabilityRecord`; `kill_pipeline_swarm.sh` and `start-swarm.sh`
  both source `availability_ledger_lib.sh` and call `availability_record`
  (and `start-swarm.sh` also calls `availability_close_ungraceful_stop`).

## Correctness read

Read `availability_ledger_lib.bb`'s `fold-intervals` and
`availability_ledger_lib.sh`'s `availability_close_ungraceful_stop` in
full against the ticket's spec (pairing rules, heartbeat-inferred close,
stale-heartbeat no-op, month-spanning fold). Both match the ticket's
description exactly; no discrepancy found between spec and implementation.

## Verdict

COMPLIANT. Forwarding to hardener.
