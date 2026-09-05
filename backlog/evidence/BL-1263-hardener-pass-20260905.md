# BL-1263 — hardener pass (redo after bounce), 2026-09-05

Ticket: BL-1263-three-standing-assertions-contradict-deliberate-source-behaviour
Commit reviewed: cc576e2fee (architect, redo pass) — coder true parent e34b387d6e

## Result: found and fixed one BL-113 mutation gap (test-side only)

## Independent re-verification (all re-run in this worktree, all green)

| check | result |
|---|---|
| `npx vitest run test/backendSwitch.test.js test/telegramClient.test.js test/telegramCursorOperatorExec.test.js` | 123/123 pass (12+87+24), matching all three redo-pass evidence files |
| `npm run compile` | clean |
| `git diff -- extension/src/` | 0 lines — zero production diff, confirmed independently |
| `git show e34b387d6e -- extension/test/backendSwitch.test.js extension/test/telegramClient.test.js extension/test/telegramCursorOperatorExec.test.js` | the three fixes match the ticket's described intent exactly — no weakening, no deletion |
| `extension/src/notify/telegramClient.ts:295-325` | `allowsMultipleAnswers = false` confirmed as the genuine shipped default, matching site 2's expectation |
| `extension/src/tools/telegramOperatorAmbulance.ts` (BL-691 D3 guard) | confirmed present exactly as described — active-only engage refusal |
| `grep -i "telegramClient\|telegramCursorOperatorExec\|backendSwitch" backlog/standing-reds.tsv` | empty — both bounced-on rows confirmed removed; unrelated `pricingTable`/BL-1212 row untouched |
| Full unit lane (`npx vitest run --config vitest.config.mjs`) | 603 passed / 606 files; exactly the 3 pre-existing unrelated failures (`pricingTable`→BL-1212, `constitutionDocCitations`, `operatorRuntimeBbFixtureClosure`→BL-1265) — none of BL-1263's three files among them |
| `node specs/pipeline/cli.js specs/features/BL-1263-...feature` (before mutation fix) | 5/5 pass |
| leftover process/fixture check (`pgrep`, `git status`) | clean before and after every run |

## BL-113 soft→hard gherkin mutation: found a real gap, fixed it

Feature has one `Scenario Outline` (3 examples, 2 mutable Examples columns
each = 6 mutants). Ran
`specs/pipeline/scripts/run_gherkin_mutation.sh <feature> <fresh mktemp under
./tmp> specs/pipeline/steps/index.js hard` (all 4 positionals explicit,
`hard` used deliberately to force genuine re-mutation rather than trust a
soft-skip against a stale stamp; workdir removed after each run).

**First run — 3 survived, 3 killed:**

| mutant | Examples column | result |
|---|---|---|
| m1, m3, m5 | `<retired expectation>` | killed |
| m2, m4, m6 | `<shipped behaviour>` | **survived** |

Root cause, found by reading
`specs/pipeline/steps/bl1263StaleAssertionsRetiredToShippedBehaviourSteps.js`:
the `<retired expectation>` column is used as the lookup KEY into the `SITES`
map (a mutated cell makes the lookup miss and `assert.ok(site, ...)` fail —
already correctly KNOWN_VALUES-shaped). But the `<shipped behaviour>` column
value, captured as `shippedBehaviour` in the `it expects (.+)` step, was
**never validated against anything** — it flowed only into an error-message
interpolation. The actual check used `ctx.bl1263.site.shippedExpectation`,
which was already resolved from the (correctly-keyed) `SITES` entry, so the
Outline's own prose cell for this column was pure decoration: mutating it
changed nothing observable. This is exactly the BL-908 KNOWN_VALUES class
from this session's rules ("a Scenario Outline handler that picks its
downstream test by SHAPE cannot kill a mutant in a value it never reads").

**Fix (test-side only, no production code touched):** added
`KNOWN_SHIPPED_BEHAVIOUR`, a map pinning each site's exact `<shipped
behaviour>` prose, and asserted `shippedBehaviour === KNOWN_SHIPPED_BEHAVIOUR[ctx.bl1263.retiredExpectationKey]`
in the `it expects (.+)` step, ahead of the existing shape-based text-content
check — the ordering the KNOWN_VALUES rule requires.

**Re-verification after the fix:**
- Acceptance feature re-run: still **5/5** pass (no assertion weakened).
- BL-113 hard mutation re-run: **6/6 mutants killed, 0 survived** —
  manifest confirms `"Total":6,"Killed":6,"Survived":0,"Errors":0`.

## Design/CRAP/DRY

No production code changed. Test-file-only fix scoped to one step-handler
file; no duplication introduced (the new map mirrors the Outline's own
Examples table 1:1, same pattern as `SITES` itself).

## Constraints respected

- `git diff --name-only` (this pass) touches only the feature file (mutation
  stamp/manifest) and the step-handler file — no test-fixture files, no
  source files.
- No other red folded in; the 3 pre-existing unrelated unit-lane failures
  are unowned by this ticket and untouched.

## Verdict

Real BL-113 gap found and fixed. Forwarding to documenter.
