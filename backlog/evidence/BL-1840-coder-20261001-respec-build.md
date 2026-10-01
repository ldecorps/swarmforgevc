# BL-1840 — coder build, 2026-10-01 (post-amendment)

## What changed

Built per the 2026-10-01 amendment (dead-zone gate, not an
`autoCompactThreshold` write):

- `swarmforge/scripts/local_model_window_gate_lib.bb`: added
  `qwen-compact-pct`/`qwen-compact-max-output-tokens`/
  `qwen-compact-buffer-tokens` (qwen's own fixed constants),
  `dead-zone-reference-window` (32768), `qwen-compaction-trigger`,
  `dead-zone-reference-trigger`, `dead-zone-upper-window` (derived, not
  hardcoded), `in-dead-zone?`, and `dead-zone-outcome` (invariant 1: flags
  exactly the windows whose trigger is below the 32768 reference).
- `swarmforge/scripts/local_model_window_gate_cli.bb`: added the
  `dead-zone` subcommand (`run-dead-zone-check` + `run-dead-zone-main`),
  thin wrapper over the lib per "Design And Testability", always printing
  `TRIGGER: <n|unknown>` to stdout before the proceed/warn/refuse verdict.
- `swarmforge/scripts/swarmforge.sh`: `check_local_model_seat_windows`
  now also calls `local_model_window_gate_cli.bb dead-zone` per seat
  (same override env var); removed the `context.autoCompactThreshold`
  key from `write_local_model_qwen_settings`'s written JSON and updated
  the comment above it to record why (ceiling derivation, not percentage).
- `specs/pipeline/steps/bl1840QwenCompressionThresholdSteps.js`: step
  handlers for the dead-zone scenarios (01/02), plus scenario 03's
  pinned-qwen proof (throwaway HOME, loopback fake `/api/show` endpoint,
  reads qwen's own `--debug` `auto=<n>` line). Registers a tmp root via
  the fixture-reaper guard (BL-1636); `stepHandlerTmpRootGuard.test.js`
  passes.
- `extension/test/bl1840QwenCompressionThresholdInvariants.property.test.js`:
  coder-authored property tests for both declared invariants (BL-654),
  non-vacuous (each shown failing against a deliberately broken
  `in-dead-zone?`/`qwen-compaction-trigger` before being restored).

## Verification (all green, this parcel's commit)

- `bb swarmforge/scripts/test/local_model_window_gate_lib_test_runner.bb`: ALL PASS
- `bash swarmforge/scripts/test/test_local_model_window_gate_cli.sh`: ALL PASS (11/11, incl. 8 new BL-1840 cases)
- `bash swarmforge/scripts/test/test_bl1829_local_model_qwen_settings.sh`: ALL PASS, confirms no `autoCompactThreshold` key written
- `node specs/pipeline/cli.js specs/features/BL-1840-...feature`: 7/7 ok (matches qa_e2e_procedure)
- `npm test` (extension/): 646 files / 10994 tests pass
- `npm run test:properties -- bl1840QwenCompressionThresholdInvariants`: 2/2 pass (both declared invariants)
- `npx vitest run test/stepHandlerTmpRootGuard.test.js`: 4/4 pass

No undeclared-invariant property-test obligation created beyond the two
declared in the ticket YAML.

By coder.
