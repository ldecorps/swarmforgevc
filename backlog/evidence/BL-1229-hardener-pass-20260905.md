# BL-1229 — hardener pass, 2026-09-05

Ticket: BL-1229-pilot-gate-deps-contract-cannot-silently-outgrow-its-test-stubs
Commit reviewed: ce2aa8089f (cleaner) / 36f9fe34e2 (architect, NONE pass)

## Result: NONE — no defect found; BL-113 mutation clean (4/4 killed)

## Re-verification (all re-run independently in this worktree, all green)

| check | result |
|---|---|
| `npx vitest run test/pilotAcceptanceGateDepsCompleteness.test.js` | 3/3 pass |
| **Live non-vacuity probe**: deleted `checkOrphanedAuthoredDocs` from `baseAcceptanceGateDeps()`, re-ran the completeness test, restored the file | failed with exactly one assertion naming `["checkOrphanedAuthoredDocs"]` as missing — reproduced independently, not taken on the coder's/architect's word; `git status` clean after restore |
| `npx vitest run --config vitest.properties.config.mjs test/bl1229PilotGateDepsContractInvariants.property.test.js` | 2/2 pass |
| `node specs/pipeline/cli.js specs/features/BL-1229-...feature` | 6/6 scenario runs |
| `git diff -- pilot-acceptance-gate.ts pilotAcceptanceGate.ts` | empty (production untouched); member still required (no `?`), call site still unconditional |
| Full unit lane (`npx vitest run --config vitest.config.mjs`) | 6 failed / 599 passed (605) — exactly the same unrelated failure set as BL-1221's own run (`backendSwitch`, `constitutionDocCitations`, `operatorRuntimeBbFixtureClosure`, `pricingTable`, `telegramClient`, `telegramCursorOperatorExec`); none of the 15 migrated files among them |
| `npm run compile` | clean |
| **DRY-fix re-verification**: `grep -c "function extractInterfaceBody\|function extractRequiredMembers"` across the two test files and the shared helper | both extractors defined exactly once, in the helper; zero local copies in either test file, both `require`ing from `./helpers/pilotAcceptanceGateDeps` — confirmed manually since my own `jscpd` invocation (config's `**/*.ts`-only pattern) found 0 files to scan, an invocation-syntax miss on my part, not evidence either way; the direct grep is conclusive |
| Spot-check 3 migrated files' assertion counts | `crossFileDuplicationCheck` 7, `pilotScopedCrapCheck` 8, `pilotAcceptanceGate.test` 32 — all match the coder's own reported per-file counts exactly |

No leaked processes/fixture roots after any run (checked via `pgrep` and a
fresh-mtime `/tmp` scan before/after). The live non-vacuity probe edited
and restored the shared helper file with `git status` confirmed clean
afterward — no orphaned edit.

## BL-113 soft gherkin mutation (one Scenario Outline, 2 examples)

Ran `specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-1229-pilot-gate-deps-contract-cannot-silently-outgrow-its-test-stubs.feature
<fresh mktemp under ./tmp> specs/pipeline/steps/index.js soft` (all 4
positionals explicit, workdir removed after). Result: **4 mutants, 4
killed, 0 survived** (the Outline's example cells, single-letter case
flips) — clean.

## Notable review depth already present

This ticket's own review chain is unusually thorough: the architect
independently reproduced the exact same non-vacuity probe I ran (delete
the member, confirm the one-failure verdict, restore, confirm clean git
status) rather than trusting the coder's evidence, and the cleaner caught
and fixed a genuine DRY violation (the two extractor functions
copy-pasted between the new completeness test and the new property test)
before this pass — exactly the kind of self-referential drift this
ticket's own subject matter warns against. My own independent
reproduction of the same probe (rather than reading the architect's and
trusting it) found the identical result.

## Design/CRAP/DRY

No production code changed. The DRY concern the cleaner found and fixed
was re-verified directly (manual grep, since the project's jscpd config
scopes to `.ts` by default and these are `.js` test files — the cleaner's
own reported jscpd numbers presumably used a different invocation than my
attempt; the manual check is unambiguous regardless).

## Verdict

No defect. Forwarding unchanged (plus the committed mutation-manifest
stamp) to documenter.
