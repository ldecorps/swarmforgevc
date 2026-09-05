# BL-1425 — hardener pass, 2026-09-05

Ticket: BL-1425-a-queue-jump-places-the-ticket-past-the-depth-cap
Commit reviewed: b0b1cc47e0 (architect NONE pass)

## Result: NONE — no defect found

## Independent re-verification (all re-run in this worktree, all green)

| check | result |
|---|---|
| `npm run compile` (run first, per the architect's own noted stale-build trap) | clean |
| `bb swarmforge/scripts/test/promotion_gates_lib_test_runner.bb` | ALL PASS |
| `bb swarmforge/scripts/test/promotion_gates_cli_test_runner.bb` | ALL PASS |
| `bb swarmforge/scripts/test/promotion_gates_lib_property_runner.bb` (500 runs each) | ALL PROPERTIES HOLD |
| `npx vitest run test/{telegramFrontDeskBotCore,backlogWriter,pausedPagerBridge,pausedPagerUiHtml}.test.js` | 532/532 pass |
| `npx vitest run --config vitest.properties.config.mjs test/{bl1083PromotionGateInvariants,bl721QjumpQueueJumpInvariants,bl1091ExpeditePromotionCommit,bl1380ExpediteNeverAnswersUnshownQuestion}.property.test.js` | 16/16 pass |
| `node specs/pipeline/cli.js specs/features/BL-1425-...feature` | 7/7 pass |
| `node specs/pipeline/cli.js` on BL-1083 (retired row), BL-721, BL-490 (regressions) | 4/4, 4/4, 8/8 pass |
| `grep -c -- --queue-jump` on the four coordinator/daemon scripts | 0 for all four |
| `npx jscpd` (new step handler vs its modeled sibling `bl1083PromotionGateSteps.js`) | 0 clones |
| `node out/tools/mutation-site-count.js` on all 4 touched TS files | 222/2036/1889 over threshold (pre-existing hub files), 28 within (the new module) — matches exactly |
| `git show b0b1cc47e0~5:<file> \| wc -l` on the 3 hub files | 250/3961/2501 lines pre-diff — independently confirms "pre-existing massive hub", not created by this ticket |
| `git diff 2cd4072055^ 2cd4072055 -- specs/features/BL-1083-...feature` | exactly one Examples row removed, nothing else touched — BL-1006 compliant |
| leftover process/fixture check (`pgrep`, `git status --short`) | clean before and after every run |

## Independently drove the real CLI myself, not just trusted the claimed output

Built a real fixture root using `installPromotionGates` (the shared
transitive-closure helper — a hand-copy of just the two files fails with
missing sibling loads, confirming why that helper exists) with
`maxDepth: 1`, one active ticket, one approved paused ticket with
`depends_on: []`. Ran the real `promotion_gates_cli.bb gate-promotion`
directly:

```
without --queue-jump: REFUSE|active_backlog_max_depth|active count 1 >= cap 1 - no open slot   (exit 2)
with --queue-jump:    ADVISORY|active_backlog_max_depth|queue-jump past cap: active count 1 >= cap 1
                      ALLOW|<file>                                                              (exit 0)
```

Exact match to the coder's and cleaner's own claimed contract.

## Independently reproduced non-vacuity myself (not just trusted)

Mutated `evaluate`'s crossing check from
`(when (and queue-jump? (depth-exceeded? active-count max-depth))` to
`(when (and queue-jump? false)`, re-ran the acceptance feature: **6/7
pass, 1 failure** (no crossing reported when the cap was in fact
crossed) — matching the coder's and architect's own claimed non-vacuity
result exactly. Restored the file, confirmed byte-identical via `diff`
and `git status --short` (empty), re-ran — 7/7 again.

## Read the chokepoint's own gate-order directly

Read `promotion_gates_lib.bb:485-513` directly: every gate above
`depends-on-refusal` runs in the identical, unchanged `or` chain order;
`depth-refusal` alone is wrapped in `(when-not queue-jump? ...)`, falling
through to `{:ok true ...}` when true; `:crossed` is added only when
BOTH `queue-jump?` and `depth-exceeded?` hold (never widens the cap or
overstates a crossing that didn't happen). Confirms all three invariants
by construction, matching every prior role's own reading.

## BL-113 hard gherkin mutation: clean

One `Scenario Outline` (scenario 01, 5 examples × 4 mutable columns = 20
mutants). Ran
`specs/pipeline/scripts/run_gherkin_mutation.sh <feature> <fresh mktemp
under ./tmp> specs/pipeline/steps/index.js hard` (all 4 positionals
explicit, workdir removed after). Result: **20 mutants, 20 killed, 0
survived** — manifest confirms
`"Total":20,"Killed":20,"Survived":0,"Errors":0"`. Scenarios 02–03 are
plain `Scenario:` blocks, not mutation targets.

## Design/CRAP/DRY

Mutation-site-count is "over" threshold on `backlogWriter.ts`,
`telegramFrontDeskBotCore.ts` and `bridgeServer.ts`, but independently
confirmed these are pre-existing, already-massive hub files (250/3961/2501
lines before this ticket's diff) that this parcel only lightly touches —
agree with cleaner's and architect's judgment that splitting an
established multi-thousand-line hub is out of scope for this small
feature. The one genuinely new module (`expediteSafety.ts`) is well
within threshold. jscpd confirms zero duplication in the new step
handler.

## Verdict

No defect. Forwarding to documenter.
