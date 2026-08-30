# BL-1218 — hardener pass, 2026-08-30

Part of a combined batch pass with BL-1252 and BL-1225 (one architect batch,
one union mutation/test pass per role instructions); recorded per-ticket to
respect the one-commit-per-ticket scope gate. See also
backlog/evidence/BL-1252-hardener-pass-20260830.md and
backlog/evidence/BL-1225-hardener-pass-20260830.md.

No `extension/src/**/*.ts` touched — bash surface, no Stryker/CRAP/DRY wired
(Engineering Rules, Startup Tools). Gate is the shell test suites, the
Gherkin acceptance-mutation lane, and the acceptance suite.

- `swarmforge/scripts/test/test_remote_control_launch_lib.sh`: 11/11 PASS
  under **both** bash and zsh (the ticket's own stated hazard — sourced by
  zsh, tested under bash — confirmed the lib's `sed`-based transform, not a
  word-split-sensitive loop, behaves identically in both shells).
- `swarmforge/scripts/test/test_remote_control_launch.sh`: 5/5 PASS. The
  stderr noise `command not found: terminal_backend_can_open_sessions` is
  pre-existing fixture scaffolding in `write_role_launch_script` unrelated
  to this ticket's own code path (not asserted against, not touched by this
  ticket's diff, not a regression).
- Gherkin mutation (`Scenario Outline` present):
  `specs/pipeline/scripts/run_gherkin_mutation.sh
  specs/features/BL-1218-config-off-is-honored-over-an-explicit-window-flag.feature
  <tmpdir> specs/pipeline/steps/index.js hard` — 12/12 killed, 0 survived,
  `outcome: pass`. Manifest embedded in the feature file
  (`tested_at: 2026-08-30T07:46:27Z`).
- Property lane (2 properties): both pass.
- Acceptance (`run_acceptance.sh` on the same feature): 7/7 passing.
- No orphaned test/mutation processes before or after this pass.

By hardener.
