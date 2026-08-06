# BL-622 — hardener re-entry pass (post-QA-bounce), 2026-08-06

Reviewed commit: 85a598667e (architect's re-entry pass), merged into hardender
as this evidence file's parent commit. Delta reviewed is everything landed
since the prior clean hardener pass (`cfe616c4`,
`backlog/evidence/BL-622-architect-pass-20260806.md` covers the architect
side of that prior cycle): documenter docs (`ab214948`), QA's D1 bounce
(`659cf4c5`) naming a raw `fs.mkdtempSync` call in coder's own property test
bypassing the shared `mkTmpDir` helper, coder's fix (`8dab2118`), and
architect's re-entry verification (`85a598667e`).

## Scope of the delta
`git diff --stat cfe616c4 HEAD` (excluding evidence/yaml bookkeeping) shows
only three files: `docs/reference/Specification.MD`,
`docs/tutorials/GettingStarted.md` (documenter's prior pass, already an
ancestor, no new changes), and
`extension/test/bl622TelegramTokenSeparationInvariant.property.test.js`
(coder's one-line bounce fix: `fs.mkdtempSync(...)` -> `mkTmpDir(...)`, plus
dropping the now-unused `os` import). **No production/source file changed**
in this delta — my prior pass (`cfe616c4`) already hardened all production
code this ticket touches; there is nothing new to mutation-test, and CRAP/DRY
were already verified against that production code and are unaffected by a
test-file-only fix.

## Host load check
`uptime` at pass start: load averages 107.58 101.10 94.97 on a 4-core host
(`sysctl -n hw.ncpu` = 4) — far past the 2x-cores threshold. Per the
mutation-testing gate, this rules out any Stryker/full-suite run this pass;
targeted vitest runs of the specific files below are lightweight enough to
run directly and are the correct scope anyway (no production code in the
delta to mutate).

## Verification run (targeted, matching the delta)
- `npx vitest run test/tmpDirMigrationGuard.test.js` (extension/) -> 11/11
  passed, including "the real extension/test/ tree has zero raw mkdtemp call
  sites outside the shared helper" — the exact BL-420 regression guard QA's
  bounce reported tripped. Clean now; coder's fix confirmed.
- `npx vitest run --config vitest.properties.config.mjs
  bl622TelegramTokenSeparationInvariant` (extension/) -> 2/2 passed, same two
  independent properties as every prior pass (env-fallback refusal iff
  not-primary-and-no-own-creds; cross-swarm token-uniqueness conflict
  detection) — kept separate from the unit/coverage/mutation gate per the
  property-test separation rule, run only as a sanity check that the fixed
  tmpdir plumbing didn't change property behavior.
- `node specs/pipeline/cli.js
  specs/features/BL-622-onboarding-telegram-token-separation.feature` -> 7/7
  scenarios pass (TAP).
- Orphan process check before/after: `pgrep -fl 'node --test|stryker|vitest'`
  clean both times.

## CRAP / DRY
Unaffected — no production file in this delta. My prior pass's CRAP/DRY
verification (`cfe616c4`) against `swarmforge/scripts/*.bb` and the shell
launcher stands; nothing to re-check here.

## Verdict
COMPLIANT. Coder's D1 fix (raw `mkdtemp` -> shared `mkTmpDir`) verified
directly against the exact regression guard QA's bounce named, plus the
ticket's own property test and full acceptance suite. Nothing else in this
delta touches production code or test coverage. Forwarding to documenter.
