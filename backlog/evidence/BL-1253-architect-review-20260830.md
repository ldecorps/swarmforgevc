# BL-1253 — architect design review, 2026-08-30

Reviewed commit `b2b0d5eb0` (coder), merged via cleaner (`11616ab8d`) into
architect as `0aa4b70bc`.

## Review-only invariant (the load-bearing one for this ticket)

- **No hotfix source touched**: `git status --porcelain -- <three hotfix
  files>` in the Background asserts empty, and I independently confirmed no
  diff to `backlog/hotfix-ledger.yaml` since before this parcel (`git diff
  3b409f9f2 HEAD -- backlog/hotfix-ledger.yaml` — empty).
- **Ledger never certified/waived by tests**: the ledger row for
  `2ec06b6ef1` still reads `state: stamp-open`, `human_decision: null`,
  matching invariant 2. Property-tested over `decide-entry-state` (400
  runs), constructed (not sampled) coverage over
  human-decided/no-human-decision/blank-decision/no-stamp-ticket/
  green-suite-no-decision, non-vacuous by breaking the code (certifying on
  an approved flag alone fails 146 draws).

## The review methodology itself

Genuinely executes the landed decision rather than pattern-matching source
text — the right choice, since the fault under review was exactly "a
decision that looked right and was never re-consulted", which a text
assertion cannot catch. `resolveUseInboundQueue` composes the three real
exported functions (`shouldUseCursorBridgeInboundQueue`,
`isFrontDeskInboundFeederLive`, `readFrontDeskPollHeartbeatMs`) the same way
the private `resolveInboundQueueFromFeeder` does, and scenarios run it
through a real `runCursorBridgePollOnce` over a real heartbeat file on disk.
The ONE place source text is read is the Background's two regex checks
tying that composition back to the actual wiring in
`telegramCursorBridgeLive.ts` — correctly scoped, since that is exactly the
gap a purely-behavioural review would otherwise leave open (a correctly-
composed helper that the poll loop doesn't actually call).

## A genuine finding, correctly not fixed here and correctly routed

The `2ec06b6ef1` ledger row's `stamp_ticket` cites **BL-1260**, not this
ticket — BL-1260 is a second, still-paused stamp-off for the SAME commit
with its own feature file (`backlog/paused/BL-1260-swarm-stamp-bridge-owns-
getupdates-when-feeder-dead.yaml`). The coder correctly did not resolve this
itself (a ticket-bookkeeping decision, not this parcel's job) and sent a
priority-00 note to the specifier instead. Verified the note was genuinely
sent: `coder`'s own sent mailbox
(`.worktrees/coder/.swarmforge/handoffs/sent/00_20260830T042705Z_001482_from_coder_to_specifier.handoff`)
exists. Not re-sending a duplicate — confirmed delivered, not merely
claimed.

## Runs (reproduced during this review)

- `cd extension && npx tsc -p .` — clean.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1253-swarm-stamp-dead-feeder-owns-getupdates-2ec06b6ef1.feature`
  — 7/7.
- `bb swarmforge/scripts/test/bl1253_stamp_ledger_human_decision_property_runner.bb`
  — ALL PASS, 400 runs, coverage over all five named shapes.
- `npx vitest run test/telegramCursorBridgeCore.test.js
  test/cursorBridgeInboundQueue.test.js --config vitest.config.mjs` —
  137/137 (the two touched-by-review unit files, exceeds the coder's claimed
  128 due to unrelated concurrent work in the same files this session).
- `npx vitest run test/telegramCursorBridgeCore.property.test.js --config
  vitest.properties.config.mjs` — 3/3.
- `bb swarmforge/scripts/test/suite_inventory_cli.bb` — 439 files, clean
  (matches claim).
- `node extension/out/tools/dependency-gate.js
  src/tools/telegramCursorBridgeLive.ts src/tools/telegramCursorBridgeCore.ts
  src/tools/cursorBridgeInboundQueue.ts` — PASSED, no forbidden edges.
- `required_wiring`: the one anchor (`bl1253DeadFeederOwnsGetUpdatesStampSteps`
  registered in `specs/pipeline/steps/index.js`) confirmed present.

## Disposition

No defect found; the one genuine finding (duplicate stamp-off ticket) is
correctly out of this parcel's scope and already routed. Forwarded to
hardender.
