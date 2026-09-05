# BL-1436 — hardener pass, 2026-09-05

Ticket: BL-1436-the-pricing-table-prices-every-model-the-swarm-runs
Commit reviewed: ac39847b98 (architect NONE pass, redo after bounce)

## Result: NONE — no defect found

## Independent re-verification (all re-run in this worktree, all green)

| check | result |
|---|---|
| `npm run compile` | clean |
| `npx vitest run test/pricingTable.test.js` | 32/32 pass (was 30/30 pre-bounce-fix; +2 new) |
| `npx vitest run --config vitest.properties.config.mjs test/pricingWindows.property.test.js` | 3/3 pass |
| `node specs/pipeline/cli.js specs/features/BL-1436-...feature` | 6/6 pass |
| `node specs/pipeline/cli.js specs/features/BL-627-...feature` (regression) | 6/6 pass |
| `grep -n claude-fable-5-1 extension/src/swarm/modelDisplayName.ts` | present (`'Fable 5.1'`) |
| `grep -c pricingTable backlog/standing-reds.tsv` | 0 |
| `npx jscpd` on the new step handler | 0 clones |
| Live smoke: `estimateCostUsd` per category on `claude-fable-5-1` | input 10, output 50, cache-read 0.25, cache-create `null` — exact match to `qa_e2e_procedure` step 3 |
| leftover process/fixture check (`pgrep`, `git status --short`) | clean before and after every run |

## Independently reproduced the architect's own bounce finding, against the fixed test

Mutated `costFrom`'s unknown-rate branch (`return null` → `continue`,
silently costing at 0), recompiled, re-ran `pricingTable.test.js`:
**1 of 32 fails** — `expected null, got 0`, at the new test the bounce's
remedy asked for. Restored the file, recompiled, confirmed byte-identical
via `diff` and `git status --short` (empty), re-ran — 32/32 again. This
exactly reproduces both the architect's original bounce measurement and
the architect's own re-verification after the coder's rework.

## Independently checked mutation-site-count and confirmed it is pre-existing debt

`node out/tools/mutation-site-count.js extension/src/metrics/pricingTable.ts`
reports 157 (over the 100 threshold) — none of the three prior roles
checked this. Independently confirmed it is NOT introduced by this
ticket: built the pre-parcel version of the file (`git show
0762f12fda^:...`), recompiled, and re-ran the tool against it: **150**
sites already, before this ticket's diff. The 7-site increase (one new
table row plus the `costFrom` loop rewrite) is proportionate to the
change; the file was already substantially over threshold beforehand
(many `PRICING_TABLE` rows, each a cluster of numeric-literal mutation
sites) — same "pre-existing hub file" class as BL-1425's and BL-1418's
own findings this session, not a defect in this parcel. Restored the
current version afterward, confirmed byte-identical.

## Independently read the fix directly

- `pricingTable.ts:81`: the `claude-fable-5-1` entry carries
  `inputPerMTok: 10, outputPerMTok: 50, cacheReadPerMTok: 0.25`, no
  `cacheCreatePerMTok` — confirmed absent, matching invariant 1's "not
  guessed, not copied from a sibling row."
- `pricingTable.ts:124-142` (`costFrom`): the per-category loop skips a
  zero-token category unconditionally, and returns `null` for the whole
  estimate the moment a NONZERO-token category has an `undefined` rate —
  read directly, matches every prior role's description exactly.
- `pricingTable.test.js:100-118`: the two new tests reproduce the
  architect's exact bounce mutation directly, and pin the fixture
  assumption (`cacheCreatePerMTok === undefined`) with a self-documenting
  comment naming what to do if that ever changes.

## BL-113 hard gherkin mutation: clean

One `Scenario Outline` (scenario 02, 3 examples, 2 mutable columns = 6
mutants). Ran
`specs/pipeline/scripts/run_gherkin_mutation.sh <feature> <fresh mktemp
under ./tmp> specs/pipeline/steps/index.js hard` (all 4 positionals
explicit, workdir removed after). Result: **6 mutants, 6 killed, 0
survived** — manifest confirms
`"Total":6,"Killed":6,"Survived":0,"Errors":0"`. Scenarios 01, 03, 04 are
plain `Scenario:` blocks, not mutation targets.

## Design/CRAP/DRY

Mutation-site-count "over" threshold, independently confirmed pre-existing
(150 sites before this ticket's diff, 157 after — a proportionate
increase, not a new debt this parcel created). jscpd confirms zero
duplication in the new step handler.

## Verdict

No defect. Forwarding to documenter.
