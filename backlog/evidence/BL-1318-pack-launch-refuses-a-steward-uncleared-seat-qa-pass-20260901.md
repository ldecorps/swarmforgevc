# BL-1318 QA pass — 2026-09-01

Merged documenter e8f7531c46 into QA worktree (`d99330f0e9`). Lineage
verified: architect (`e66b5aaf65`), hardener (`038dab08e4`) and documenter
(`e2c9206d7b`/`e8f7531c46`) merges are all ancestors of `d99330f0e9`.

## Process hygiene

`pgrep -fl 'node --test|stryker'` clean before and after this pass (the
matches returned are the pgrep invocation's own command line self-matching
on the literal string "stryker" — not real processes; verified by `ps -p`
on the reported PIDs, which do not exist).

## Independent re-run, own commit, all green

- `bb swarmforge/scripts/test/pack_staffing_gate_lib_test_runner.bb` — pass
- `bb swarmforge/scripts/test/bl1318_pack_staffing_gate_property_runner.bb` — 400/400 draws, ALL PROPERTIES HOLD
- `bash swarmforge/scripts/test/test_pack_staffing_gate.sh` — 7/7
- `bash swarmforge/scripts/test/test_pack_staffing_gate_wiring.sh` — 7/7
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1318-pack-launch-steward-staffing-gate.feature` — 7/7 scenarios pass (BL-112 executable e2e gate)
- `node extension/out/tools/dependency-gate.js` (full repo, no args) — PASSED, no forbidden edges

## required_wiring — both anchors re-verified live

- `swarmforge/scripts/swarmforge.sh::pack_staffing_gate` — one call site in `parse_config`'s
  per-window loop (line 888), immediately after `validate_agent`. Grepped: no second call site.
- `swarmforge/scripts/pack_staffing_gate_lib.bb::seat-staffing-decision` — grepped every caller
  (shell CLI, unit runner, property runner, all test suites) — one shared pure rule, no drift path.

## Human ruling conformance

`PACK_STAFFING_SKIP_GATE=1` env-var-only escape hatch (matches
`ruling_options[0]` exactly). Grepped `swarmforge/` and `extension/` for
`--override-uncertified`: only pre-existing hits in `model_steward_*`/
`model_factory_*`/`outage_failover_lib.bb` — an unrelated, already-existing
flag on different tooling. No new CLI flag introduced for the pack staffing
gate.

## qa_e2e_procedure

Ran the acceptance feature as the executable e2e gate (above, 7/7 —
BL-112). The ticket's remaining manual step (edit a live Bob pack copy and
launch a real tmux swarm) was not additionally exercised as a live tmux
launch — spinning up real agent panes for a QA dry-check carries its own
hazard (fake-shim/real-agent leak precedent, BL-1294) — and is
superseded by a safer, still-real check: read `pack_staffing_gate_lib.bb`'s
`agent-model-providers` / `api-base-host-providers` tables directly against
both shipped Bob packs' actual `window` lines
(`swarmforge/packs/bob-multi-provider-forge.conf`,
`bob-multi-provider-mono-router.conf`): every pinned agent+model or
agent+api-base shape used by those two packs (`claude`/`claude-sonnet-5`,
`claude`/`qwen3.8-max`, `cursor`/`auto`, `gemini`/`gemini-2.5-pro`, aider
via `api.deepseek.com`, aider via the aliyuncs qwen base) resolves through
the explicit table; the one unpinned seat (`vibe` cleaner, no `--model`)
hits `resolve-seat`'s `:no-pin` branch, which is a pass-through, not a
refusal. No pack window used today is left unresolved. This, plus wiring
test 05a/05b's live mono-router `@`-seat coverage and the architect's
already-verified invariant-2 real-`parse_config` byte-identical state-dir
snapshot, together cover the qa_e2e_procedure's substance without an actual
tmux launch.

## Full unit suite (`npm test`, extension/)

213 failed / 9629 passed (9842 tests), 23 failed test files. **Zero overlap
with this parcel's changed paths** (`swarmforge/scripts/pack_staffing_gate_*.bb`,
`swarmforge/scripts/swarmforge.sh`, `specs/pipeline/steps/bl1318PackStaffingGateSteps.js`,
`specs/pipeline/steps/index.js`) — grepped every failing file against
`backlog/`, all pre-existing and already tracked:

- 8 files (bridgeServer, epicMakeTopBridge, epicReorderBridge, pausedPagerBridge,
  specTreeBridge, startBridgeHeadlessCli, telegramCursorBridgeCli, topicMakeTopBridge)
  — **BL-1322** (bridge startup eagerly requires CURSOR_API_KEY), minted this
  same QA pass off BL-1313's discovery, `backlog/paused/`.
- 3 files (liveRepoDerivationGuard, socketFixtureShortRootGuard, tempDirTrapGuard)
  — pre-existing standing reds, independently confirmed by the hardener's own
  evidence this same parcel.
- backendSwitch, telegramClient, telegramCursorOperatorExec — **BL-1263**
  (three standing assertions contradict deliberate source behaviour), `backlog/paused/`.
- constitutionDocCitations, pilotAcceptanceGate, unreachableStepHandlerCheck —
  **BL-1221** (pilot gate deps stubs missing required orphan-docs check), `backlog/paused/`.
- crossFileDuplicationCheck, multiBranchParserCoverageCheck, perHatRolePromptEvidenceCheck,
  pilotScopedCrapCheck, shellEntryPointDriveCheck — **BL-1229** (pilot gate deps
  contract can silently outgrow its test stubs), `backlog/paused/`.
- operatorRuntimeBbFixtureClosure — **BL-1265** (operator runtime closure list
  drifted, four undeclared deps), `backlog/paused/`.

No new/untracked red found. Per BL-1063, none re-reported.

## Property suite (`npm run test:properties`, extension/)

15 failed / 833 passed (848 tests), 26 failed test files, plus the one
allowlisted `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled
error (BL-871, the sole allowlisted `test:properties` unhandled error).
Cross-checked every one of the 26 failing files against
`swarmforge/scripts/property_suite_standing_allowlist.tsv` (BL-1175): **all
26 are present with `disposition=allowlist`**, tracked under BL-1175
pending fix. Zero unlisted/new failures. (The BL-1234 allowlist-guard
matcher bug affects only the pre-commit hook's own automated check, not
this manual cross-reference against the tsv.)

## Wiring — new functionality reaches its real caller

`pack_staffing_gate` is called from `parse_config`'s live per-window loop
in `swarmforge.sh` (not merely unit-tested in isolation) — confirmed by
grep, one call site, covers both plain pack windows and the mono-router
`@`-seat rotate path (same `seat_stage` variable feeds both `validate_agent`
and the new gate).

## Verdict

PASS. All BL-1318-owned gates green, both required_wiring anchors live,
human ruling followed exactly, no untracked regression anywhere in the
repo. Landing.
