# BL-1430 — hardener pass, 2026-09-05

Ticket: BL-1430-the-portable-time-guard-has-one-definition
Commit reviewed: 4cf92d6288 (cleaner) / 7502740702 (architect, NONE pass)

## Result: NONE — no defect found

## Re-verification (all re-run independently in this worktree, all green)

| check | result |
|---|---|
| `npx vitest run --config vitest.properties.config.mjs test/bl874PortableTimeInvariants.property.test.js` | 6/6 pass |
| `npx vitest run --config vitest.properties.config.mjs test/tempDirTrapGuard.property.test.js test/bl1175PropertySuiteStandingRedsInvariants.property.test.js` | 9/9 and 3/3 pass |
| `node specs/pipeline/cli.js specs/features/BL-1430-...feature` | 2/2 scenario runs |
| `git grep "function findPortableTimeViolation" -- extension/src specs/pipeline` | exactly one file: `specs/pipeline/steps/lib/portableTimeGuard.js` |
| `grep -i "bl874\|tempDirTrapGuard" backlog/standing-reds.tsv property_suite_standing_allowlist.tsv` | no matches (both rows removed from both files) |
| Full properties suite (`npx vitest run --config vitest.properties.config.mjs`, backgrounded, 227.8s) | **18 files failed / 339 passed (357)** — matches exactly the coder's/architect's/cleaner's own reported count (the 18 remaining allowlist rows); the only errors are the known-benign, allowlisted `[vitest-worker]: Timeout calling "onTaskUpdate"` (BL-871), per engineering.prompt |
| `bl1430PortableTimeGuardSingleDefinitionSteps.js::registerSteps` present | yes (required_wiring) |

No leaked processes/fixture roots after any run (checked via `pgrep` and a
fresh-mtime `/tmp` scan before/after; the full-suite run was backgrounded
by the harness for exceeding the 120s foreground timeout, watched to
completion rather than left unattended).

## No BL-113 gherkin mutation (no Scenario Outline)

The feature is two plain `Scenario:` blocks, no `Scenario Outline:` /
`Examples:` — inapplicable per BL-638. This ticket also makes no
generative-property-testable change (it narrows an existing property's
directory walk; there is no random input axis to fuzz beyond the
repository's own file tree, which both the property and the independent
`git grep` cross-check already exhaustively count) — the coder's own
non-vacuity argument (two independently-implemented counting mechanisms
agreeing) is the right substitute here, and I independently reproduced
both counts myself above rather than trusting the coder's numbers alone.

## Verified the self-referential grep fix directly

Read `bl1430PortableTimeGuardSingleDefinitionSteps.js` and confirmed:

```
grep -c "function findPortableTimeViolation" bl1430PortableTimeGuardSingleDefinitionSteps.js
0
```

The step handler's own git-grep pattern is built via string concatenation
(`'function ' + 'findPortableTimeViolation'`), so the contiguous phrase
the guard searches for never appears literally in the handler's own
tracked source — confirmed empirically, not merely by reading the coder's
description of the fix. This is the exact self-referential trap the
coder's own evidence documents catching post-commit (untracked files are
invisible to `git grep`, tracked ones are not) — worth independently
confirming given it is precisely the class of subtle bug a fresh set of
eyes should re-check rather than take on faith.

## Design/CRAP/DRY

No production code changed by this pass (`portableTimeGuard.js` and every
caller are untouched, confirmed by `git diff` — only test-scoping and
register/allowlist bookkeeping files changed). No mutation-worthy
production logic to harden.

## Verdict

No defect. Forwarding unchanged to documenter.
