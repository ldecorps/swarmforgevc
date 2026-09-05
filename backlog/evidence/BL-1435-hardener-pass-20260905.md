# BL-1435 — hardener pass, 2026-09-05

Ticket: BL-1435-a-rev-parse-root-is-a-live-read
Commit reviewed: afa4423e59 (architect NONE pass)

## Result: NONE — no defect found

## Independent re-verification (all re-run in this worktree, all green)

| check | result |
|---|---|
| `npx vitest run test/liveRepoDerivationGuard.test.js` | 24/24 pass (19 original + 5 new) |
| `npx vitest run test/{docsStructureRealTree,bl1300HeadroomProofIsPinned,gitEnvGuard,activePoolFreshnessAudit,swarmMetricsCli}.test.js` (the five files alone) | **79/79 pass** — independently confirms the cleaner's and architect's own arithmetic catch (the coder's evidence table stated 103, which is that count PLUS the guard's own 24; every individual test genuinely passes either way) |
| `node specs/pipeline/cli.js specs/features/BL-1435-...feature` | 6/6 pass |
| `node specs/pipeline/cli.js` on BL-1038, BL-1212 (regressions) | 8/8, 2/2 pass |
| `findLiveRepoDerivations("test")` (called directly) | `[]` |
| `violationFor` red/green pair on `docsStructureRealTree.test.js` (reproduced independently, exemption comment stripped via regex) | `null` with the reason present; a real `computeDocsStructure` production-escape violation when stripped |
| `grep -n "show-toplevel\|__dirname"` on `bl1300HeadroomProofIsPinned.test.js` | binds `__dirname` via rev-parse, confirmed |
| `grep -n "show-toplevel\|target\|decoy"` on `gitEnvGuard.test.js` | rev-parse calls target `target`/`decoy` fixtures, never `__dirname`, confirmed |
| `grep -n show-toplevel` on `activePoolFreshnessAudit.test.js`/`swarmMetricsCli.test.js` | both are comment-only mentions, no actual rev-parse call, confirmed |
| `npx jscpd` on the 3 touched/new files | 0 clones |
| `backlog/standing-reds.tsv` / `property_suite_standing_allowlist.tsv` | neither names this file family |
| leftover process/fixture check (`pgrep`, `git status --short`) | clean before and after every run |

## Independently read the widened regex directly

Read `REV_PARSE_TOPLEVEL_SRC`, `LIVE_ROOT_BINDING_RE`, `LIVE_ROOT_INLINE_SRC`
directly (`extension/test/helpers/liveRepoDerivationGuard.js:55-108`): one
alternation, folded into both the named-binding and inline detections;
`growthPatternsFor`/`EXEMPTION_RE` untouched (confirmed via `git diff` —
byte-identical to before this ticket), so both idioms feed the exact same
downstream rules by construction — matches invariant 1 exactly.

## Independently reproduced non-vacuity myself (not just trusted)

Mutated `REV_PARSE_TOPLEVEL_SRC` to match nothing (prepended `(?!x)x` via
`sed` on the exact source line, since the regex's own special characters
made a Python string-replace brittle), re-ran the guard's unit test:
**4 of 5 new BL-1435 tests failed immediately** — the inline-form test,
the bare-marker test, and both call-shape assertions inside the
execSync/spawnSync test — matching the coder's and architect's own
claimed non-vacuity result exactly. Restored the file, confirmed
byte-identical via `diff` and `git status --short` (empty), re-ran —
24/24 again.

## BL-113 hard gherkin mutation: clean

Two `Scenario Outline`s: scenario 01 (3 examples, 1 mutable column = 3
mutants) and scenario 02 (2 examples, 2 mutable columns = 4 mutants), 7
total. Ran `specs/pipeline/scripts/run_gherkin_mutation.sh <feature>
<fresh mktemp under ./tmp> specs/pipeline/steps/index.js hard` (all 4
positionals explicit, workdir removed after). Result: **7 mutants, 7
killed, 0 survived** — manifest confirms both scenarios at
`"Total":3,"Killed":3` and `"Total":4,"Killed":4`, zero survivors/errors
in either. Scenario 03 is a plain `Scenario:`, not a mutation target.

## Design/CRAP/DRY

`liveRepoDerivationGuard.js` is a plain JS test helper (not compiled
TypeScript), so mutation-site-count tooling does not apply — matches all
three prior roles' own disposition. jscpd confirms zero duplication
across the three touched/new files.

## Verdict

No defect. Forwarding to documenter.
