# BL-918 / BL-917 architect pass — 2026-08-18

## Scope

Received from cleaner as two separate `git_handoff` parcels (Article 2.6),
both pointing at the same commit `67887b9d50` — cleaner made no changes of
its own on top of coder's work, so the tip is coder's second commit in the
pair:

- `47056b5d1` — BL-918: classify chaser telemetry at the composer, not by
  luck (`extension/src/metrics/leanLedgerComposeStall.ts` and callers).
- `67887b9d5` — BL-917: respawn-self! recomposes the role prompt too, not
  just rotation (`swarmforge/scripts/handoff_lib.bb`).

Two unrelated tickets sharing one commit range purely by batch scheduling.
Reviewed independently below; each gets its own `git_handoff` to hardender
per Article 2.6.

Files reviewed (`git diff f6b9dd9bc..67887b9d50 --stat`):
- `extension/src/metrics/leanLedgerCompose.ts`
- `extension/src/metrics/leanLedgerComposeStall.ts`
- `extension/src/tools/lean-ledger-record.ts`
- `extension/test/bl918PeriodicSamplesAreNotStalls.property.test.js`
- `extension/test/leanLedgerCompose.test.js`
- `extension/test/leanLedgerRecordCli.test.js`
- `specs/pipeline/steps/bl911RotationRecomposesRolePromptSteps.js`
- `specs/pipeline/steps/bl918PeriodicSamplesAreNotStallsSteps.js`
- `specs/pipeline/steps/index.js`
- `swarmforge/scripts/handoff_lib.bb`
- `swarmforge/scripts/test/bl917_recompose_never_loses_prompt_on_failure_property_runner.bb`
- `swarmforge/scripts/test/test_rotate_recomposes_role_prompt.sh`

## BL-918 — checks run (complete inventory)

1. **Classification boundary matches the ticket's shape-of-fix** —
   `leanLedgerComposeStall.ts` now allowlists `CHASER_ATTENTION_SIGNAL_TYPES
   = ['chase','nudge','dead-letter','respawn']` at the one composer, not a
   denylist of known sample types — a sample type invented later defaults
   excluded, matching invariant 1's "or are added later" clause.
2. **Out-of-scope respected** — `failureModeInventory.ts`'s own local
   `resource_sample` filter is untouched (`git diff f6b9dd9bc..67887b9d50 --
   extension/src/metrics/failureModeInventory.ts` and `closingCeremony.ts`
   both empty). handoffd's telemetry emission is untouched.
3. **Declared invariants (2, per the ticket YAML) — Invariants Review**:
   - Invariant 1 ("only attention signals become `stall` events, whatever
     sample type exists today or is invented") — coder-authored property
     test, `bl918PeriodicSamplesAreNotStalls.property.test.js`, generator
     mixes real attention types, known sample types, AND arbitrary strings
     standing in for future sample types. Re-ran independently: 100/100
     runs, green.
   - Invariant 2 ("exclusion happens at the composer, so no consumer
     re-filters") — second property test runs the SAME composed events
     through two independent downstream readers with no type filter of
     their own (`foldLeanLedgerSnapshot`, `closingCeremony`'s
     `buildClosingCeremonyPacket`) and asserts both land on exactly the
     attention-signal count. Re-ran independently: 100/100 runs, green.
   - Both tests' non-vacuity is documented in the file's own header
     (temporarily removing the `isAttentionSignal` guard made both fail);
     took this on the file's word since it is independently re-verifiable
     by inspection of the guarded `continue` in `composeStallEvents` — a
     single `continue` with no guard is exactly what the property would
     catch.
4. **Unrecognized-type reporting (scenario 03)** —
   `unrecognizedChaserTelemetryTypes` reads the raw telemetry file
   independent of any ticket window, surfaced on `lean-ledger-record.ts`'s
   own stdout as `unrecognizedTelemetryTypes`. Confirmed it is additive
   (existing `{ ticket, composed, appended, snapshot }` shape unchanged,
   new key appended) — no consumer of the old shape breaks.
5. **Dependency-rule gate (BL-259 hard gate)** — ran
   `node extension/out/tools/dependency-gate.js src/metrics/leanLedgerCompose.ts
   src/metrics/leanLedgerComposeStall.ts src/tools/lean-ledger-record.ts`
   after a fresh `npm run compile`: `Dependency-rule gate PASSED: no
   forbidden edges.`
6. **Co-change coupling (BL-255)** — ran
   `node extension/out/tools/co-change-report.js` against the same three
   files: nothing at or above the default threshold (min-frequency 3,
   min-group-size 2); every reported pairing tops out at 2. No suspected
   coupling.
7. **Two-layer boundary / host-IO / webview-storage / secrets** — not
   applicable: no tile/webview code, no VS Code API surface touched. This is
   metrics/composer code the extension host already owns.
8. **Acceptance (BL-233)** — live `.feature`, step handlers registered in
   `specs/pipeline/steps/index.js`. Ran directly:
   `node specs/pipeline/cli.js specs/features/BL-918-periodic-samples-are-not-stalls.feature`
   → 9/9 concrete cases pass (5 scenarios, one an Outline with 4 cases, one
   with 2).
9. **Unit tests** — `npx vitest run test/leanLedgerCompose.test.js
   test/leanLedgerRecordCli.test.js` → 38/38 pass, including 6 new BL-918
   example-based tests (both known sample types, an unrecognized type, all
   four attention-signal types attributed, `unrecognizedChaserTelemetryTypes`
   reporting/dedup/sort/empty-file cases).
10. **Property-testing pass (own section)** — both declared invariants
    already carry coverage per #3; no additional undeclared-property gap
    found on the touched pure module beyond what the ticket's own
    invariants require.

No architecture violation, no invariant violation, no correctness defect
found for BL-918.

## BL-917 — checks run (complete inventory)

1. **Mirrors the established BL-911 chokepoint pattern** — `respawn-self!`
   now calls `recompose-role-prompt!` before its `respawn-pane`, same
   function and same failure posture `rotate-resident-to!` already uses
   (confirmed by reading both call sites side by side in
   `handoff_lib.bb`): a recompose failure is reported to `*err*` but never
   blocks the respawn.
2. **`recompose-role-prompt!` itself is unchanged** — this ticket adds a
   second caller, not new failure-handling logic. Confirmed its existing
   docstring/contract (no metadata sidecar / blank compose result / any
   thrown exception → `{:ok false :reason ...}`, prompt file left
   untouched) is exactly what BL-917's invariant 2 requires, with no
   modification needed.
3. **Declared invariants (2, per the ticket YAML) — Invariants Review**:
   - Invariant 1 ("every re-exec path recomposes first") — the ticket's own
     approval_context and the coder's commit both record a STATED
     non-encodability reason (quantifies over the codebase's own finite,
     already-enumerated set of exactly two re-exec call sites, not a
     runtime input space) rather than a property test. Accepted: covered
     instead by the deterministic acceptance scenarios (01/02 for
     rotate-resident-to!, 05 for respawn-self!) proving recompose precedes
     respawn on both call sites — re-ran live, below.
   - Invariant 2 ("a recompose failure never blocks the boot, and is
     reported") — coder-authored property test,
     `bl917_recompose_never_loses_prompt_on_failure_property_runner.bb`,
     over `recompose-role-prompt!` itself for any of the project's 8 real
     role names and any prior prompt content (0-200 char generated string),
     forcing failure via a missing metadata sidecar. Asserts byte-identical
     prompt file, `{:ok false ...}`, never throws. Re-ran independently:
     `bb swarmforge/scripts/test/bl917_recompose_never_loses_prompt_on_failure_property_runner.bb`
     → 200/200 runs, generator coverage 8/8 roles, ALL PROPERTIES HOLD.
   - Non-vacuity documented in the runner's own header (a deliberate
     "spit a sentinel onto the prompt file even on failure" mutant made
     every run fail; restored before commit) — plausible and consistent
     with the guarded-`spit`-only-on-success shape of
     `recompose-role-prompt!` itself (read directly, not taken on faith).
4. **Idle-clear-off no-op preserved (scenario 07, the risk this ticket
   could most easily get wrong)** — traced `respawn-self!`: the new
   `recompose-role-prompt!` call happens unconditionally inside
   `respawn-self!` itself, which per BL-089 is only ever invoked from
   `maybe-clear-at-idle-boundary!` when `idle-clear-enabled?` already
   returned true for that role. `idle-clear-enabled?` (unchanged) still
   gates the call to `respawn-self!` at the source — with idle-clear off,
   `respawn-self!` is never reached at all, so nothing new is recomposed on
   every parcel completion. Confirmed by scenario 07 passing for real
   (below): no `respawn-pane` call, composed prompt untouched.
5. **Gherkin mutation-stamp scope (ticket's own note, checked not assumed)**
   — the ticket flags the embedded manifest at the top of
   `specs/features/BL-911-rotation-recomposes-the-role-prompt.feature` as
   "now stale." Checked: that manifest was generated by BL-911's own
   hardening pass (`206bc64c2`, "By hardender") and covers ONLY the file's
   two Scenario Outlines (index 0/1) — BL-113 Gherkin Scenario Outline
   mutation applies to Outlines only. BL-917 adds three plain `Scenario`s
   (05-07), zero new Outlines, and the `Background` text the manifest's
   `background_hash` covers is unchanged. So the existing manifest is not
   actually invalidated by this diff — its scope was never claiming
   coverage of 03/04/05/06/07 in the first place (03/04 aren't in it
   either, same reason). Not a defect; left for hardener's own standing
   Gherkin-mutation gate to re-run and re-stamp in the normal course of
   their pass (same role that produced the manifest originally), not
   something to bounce back to coder.
6. **Degraded gating acknowledged, not implied away** — Babashka has no
   Stryker/CRAP/DRY (engineering.prompt Startup Tools); this parcel's gate
   is its own unit/acceptance/property suite under
   `swarmforge/scripts/test/`, run directly below. Correctly noted in the
   ticket's own notes; hardener must record this as the degraded fallback
   per the ticket, not something architect need re-flag beyond confirming
   the suite actually ran green.
7. **Two-layer boundary / host-IO / webview-storage / secrets /
   integrate-not-fork** — not applicable: no VS Code extension code
   touched. Fork-maintenance on the swarm's own launch/rotation machinery,
   same category as BL-911, BL-913.
8. **Dependency-rule / co-change gates** — N/A, no `extension/src/` files
   touched by this ticket's own diff (`handoff_lib.bb` only).
9. **Acceptance (BL-233)** — feature file already extended by the
   specifier at spec time (`2ea28331c`, an ancestor of this commit); step
   handlers for scenarios 05-07 landed in THIS parcel
   (`bl911RotationRecomposesRolePromptSteps.js`). Ran directly:
   `node specs/pipeline/cli.js
   specs/features/BL-911-rotation-recomposes-the-role-prompt.feature` →
   10/10 concrete cases pass (7 scenarios, two Outlines contributing the
   extra 3 cases).
10. **Fixture shell test re-run independently** — `bash
    swarmforge/scripts/test/test_rotate_recomposes_role_prompt.sh` → all 7
    markers (01-07) PASS, including the new 05/06/07 driving the REAL
    `ready_for_next_task.bb --idle-boundary` entrypoint against a
    disposable fixture repo (never the wrapper `.sh`, for the cwd-resolution
    reason documented in the fixture's own header — verified true by
    reading `ready_for_next_task.sh`'s `cd "$SCRIPT_DIR"` line).
11. **Property-testing pass (own section)** — invariant 2 already carries
    coverage per #3; no additional undeclared-property gap found on
    `recompose-role-prompt!` or its two callers beyond what the ticket's
    own invariants require.

No architecture violation, no invariant violation, no correctness defect
found for BL-917.

## Verdict

Clean review pass, both tickets: no architecture violation, no invariant
violation, no correctness defect found for either BL-918 or BL-917.
Forwarding both to hardender as two separate `git_handoff`s per Article 2.6,
naming this commit.

By architect.
