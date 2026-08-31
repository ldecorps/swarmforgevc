# BL-1253 — hardener pass, 2026-08-31

Merged architect's tip `638f627e8d` into hardender cleanly (bf686b27a1/BL-1240
already an ancestor of my branch, so no deletion-guard conflict this time).

## Context: this is the third pipeline round for this ticket

This ticket has already been hardened twice before, both reachable ancestors
of my current tip: `53b610e712` (first round, before the QA bounce) and
`1acbe01be2` (second round, after the coder fixed the QA bounce — scenario
06's missing step handler). QA's bounce (`207dc0c03b`) is closed. The
coder's latest pass (`94301a6c72`, evidence
`BL-1253-coder-restamp-20260831.md`) states the remedy was already on `main`
and this round re-verifies rather than re-fixes — confirmed directly: none
of the ticket's own files (feature file, step handlers, property test) have
any diff between the second hardener pass (`1acbe01be2`) and this tip
(`638f627e8d`).

Review-only ticket (BL-848 stamp-off): confirms or refutes already-landed
hotfix `2ec06b6ef1`, never reimplements it. No production hotfix source
(`cursorBridgeInboundQueue.ts`, `telegramCursorBridgeLive.ts`,
`telegramCursorBridgeCore.ts`, `start_cursor_bridge.sh`) is touched by this
ticket's own commits.

## Runs performed (re-confirmation, not new work)

- Acceptance: `run_acceptance.sh` on the feature file -> **8/8 pass**
  (scenario 06's handler present and registered; QA's bounced gap is closed).
- Property: `bl1253TokenOwnershipInvariants.property.test.js` (properties
  config) -> 4/4 pass, including invariant 3 (at most one `getUpdates`
  poller per token; the token comes back on recovery — the invariant carried
  from retired BL-1260).
- Unit (qa_e2e_procedure step 4): `cursorBridgeInboundQueue.test.js`,
  `telegramCursorBridgeCore.test.js`, `telegramCursorBridgeLive.test.js` ->
  258/258 pass.
- `hotfix_certification_lib_test_runner.bb` -> ok.
- Ledger row for `2ec06b6ef1` re-read directly: `state: stamp-open`,
  `stamp_ticket: BL-1253`, `human_decision: null` — untouched, invariant 2
  holds.
- BL-113 Gherkin mutation: the feature's one `Scenario Outline` already
  carries a valid manifest stamp (`tested_at: 2026-08-30T04:35:12Z`,
  `Total:6 Killed:6 Survived:0 Errors:0`) from the second hardener pass, and
  the feature file has zero diff since then — the stamp is still valid
  (BL-460: a soft re-run would report `total=0 skipped=N` by design, not
  evidence of a broken tool; not re-run, since nothing changed to re-test).
- Standing whole-tree guards (parcel touches `extension/test/` and
  `specs/pipeline/steps/`): same 3 pre-existing failures as the last two
  hardener passes on this branch (tempDirTrapGuard,
  socketFixtureShortRootGuard, liveRepoDerivationGuard), none touching this
  parcel's files, already ticketed (BL-1289/1290/1291, paused).

## The one outstanding human question

The 90-second stall-window decision (carried from retired BL-1260,
`DEFAULT_FRONT_DESK_FEEDER_STALL_MS = 90_000` at
`telegramCursorBridgeCore.ts:371`) remains unanswered per the ticket's own
`approval_context`. Not this pass's gate to close — it belongs to the
eventual human ledger decision, same posture QA and the coder both recorded.

## Orphan check

`pgrep -fl 'node --test|stryker'` scoped to this worktree: clean before and
after. `git status --short` clean at handoff.

## Verdict

Clean. No test gaps found. Forwarding to documenter.
