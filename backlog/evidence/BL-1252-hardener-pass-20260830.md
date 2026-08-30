# BL-1252 — hardener pass, 2026-08-30

Part of a combined batch pass with BL-1225 and BL-1218 (one architect batch,
one union mutation/test pass per role instructions); recorded per-ticket to
respect the one-commit-per-ticket scope gate. See also
backlog/evidence/BL-1225-hardener-pass-20260830.md and
backlog/evidence/BL-1218-hardener-pass-20260830.md.

No `extension/src/**/*.ts` touched — bash surface, no Stryker/CRAP/DRY wired
(Engineering Rules, Startup Tools). Gate is the shell test suite, the Gherkin
acceptance-mutation lane, and the acceptance suite.

- `swarmforge/scripts/test/test_run_commit_guards.sh`: 10/10 PASS, including
  case 03 (two guards refuse, both run, both named) which the coder's own
  evidence documents as the case that FAILS against the pre-ticket
  `set -euo pipefail` chain — the non-vacuity proof for this ticket's whole
  point.
- Gherkin mutation (`Scenario Outline` present):
  `specs/pipeline/scripts/run_gherkin_mutation.sh
  specs/features/BL-1252-commit-guard-chain-reports-every-violation.feature
  <tmpdir> specs/pipeline/steps/index.js hard` — 6/6 killed, 0 survived,
  `outcome: pass`. Manifest embedded in the feature file
  (`tested_at: 2026-08-30T07:46:39Z`).
- Acceptance (`run_acceptance.sh` on the same feature): 9/9 passing.
- No orphaned test/mutation processes before or after this pass
  (`pgrep -fl` scoped check).

By hardener.
