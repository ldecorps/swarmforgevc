# BL-622 — architect re-entry pass (post-QA-bounce), 2026-08-06

Reviewed commit: 8dab2118ce, merged into architect as this evidence file's
parent commit. Delta reviewed is everything landed since the prior clean
architect pass (`d52b9b7c`, `backlog/evidence/BL-622-architect-pass-20260806.md`):
hardener coverage (`cfe616c4`), documenter docs (`ab214948`), QA's D1 bounce
(`659cf4c5`) naming a raw `fs.mkdtempSync` call in the coder's own property
test bypassing the shared `mkTmpDir` helper, and coder's fix (`8dab2118`).

## Dependency-rule gate (Article 1.5 REQUIRED HARD GATE, BL-259)
`node extension/out/tools/dependency-gate.js test/bl622TelegramTokenSeparationInvariant.property.test.js`
(the only `extension/` file in this delta) — PASSED, no forbidden edges.

## Co-change / logical coupling (BL-255)
`node extension/out/tools/co-change-report.js test/bl622TelegramTokenSeparationInvariant.property.test.js` —
every co-change is frequency 1, below the default flag threshold (3). No
suspected coupling.

## Invariants review (BL-633/BL-654)
Ticket's single declared invariant is unchanged by this delta — the fix only
swaps the property test's own other-primary tmpdir creation
(`fs.mkdtempSync` -> `mkTmpDir`) and drops the now-unused `os` import; it
does not touch either property's oracle or assertions. Re-ran both:
`npx vitest run --config vitest.properties.config.mjs bl622TelegramTokenSeparationInvariant`
-> 2/2 passed, same two independent, non-vacuous properties as the prior
pass (env-fallback refusal iff not-primary-and-no-own-creds; cross-swarm
token-uniqueness conflict detection).

## Regression guard QA's bounce named
`npx vitest run test/tmpDirMigrationGuard.test.js` -> 11/11 passed, including
"the real extension/test/ tree has zero raw mkdtemp call sites outside the
shared helper" — the exact BL-420 guard QA's bounce reported tripped. Clean
now.

## Architecture rules re-checked against the full delta
- Hardener's addition (`fleet_telegram_creds_lib_test_runner.bb`: a
  self-exclusion case for `conflicting-swarm`) and end-to-end test
  (`test_launch_front_desk.sh` case 4c) stay entirely within
  `swarmforge/scripts/test/` — no VS Code API/webview surface, no secrets
  written outside `~/.swarmforge/fleet/...`.
- Documenter's `Specification.MD` / `GettingStarted.md` updates describe the
  shipped behavior accurately against the code as re-read; no drift found.
- `bounce_history` recorded correctly on the ticket YAML (QA, coder-blamed,
  class unit, evidence link) — nothing for architect to add here.
- Two-layer boundary, integrate-not-fork, secrets-in-env-only: all
  unaffected, same as the prior pass.

## Verification run (spot check, not a replacement for hardener/QA's own pass)
- `npx vitest run --config vitest.properties.config.mjs bl622TelegramTokenSeparationInvariant` — 2/2 passed
- `npx vitest run test/tmpDirMigrationGuard.test.js` — 11/11 passed
- `node specs/pipeline/cli.js specs/features/BL-622-onboarding-telegram-token-separation.feature` — 7/7 scenarios pass (TAP)

## Verdict
COMPLIANT. No architecture violations found in the bounce-fix delta.
Forwarding to hardener.
