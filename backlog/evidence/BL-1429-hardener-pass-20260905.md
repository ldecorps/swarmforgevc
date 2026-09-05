# BL-1429 — hardener pass, 2026-09-05

Ticket: BL-1429-standing-reds-throttle-intake
Commit reviewed: 1011fd335f (architect, redo pass after bounce)

## Result: NONE — no defect found; 5 BL-113 survivors confirmed EQUIVALENT from the code

## Independent re-verification (all re-run in this worktree, all green)

| check | result |
|---|---|
| `npm run compile` (needed first — `out/` was stale before this pass) | clean |
| `npx vitest run test/standingRedSignal.test.js test/emitThrottleRecommendationStandingRed.test.js test/emitThrottleRecommendationCli.test.js` | 36/36 pass (11+9+16) |
| `npx vitest run --config vitest.properties.config.mjs test/bl1429StandingRedThrottleFoldInvariants.property.test.js` | 4/4 pass |
| `node specs/pipeline/cli.js specs/features/BL-1429-standing-reds-throttle-intake.feature` | 8/8 pass |
| `node specs/pipeline/cli.js specs/features/BL-432-auto-tune-intake-throttle.feature` (regression) | 5/5 pass |
| `node out/tools/mutation-site-count.js extension/src/metrics/standingRedSignal.ts extension/src/tools/emit-throttle-recommendation.ts` | 94, 96 — both within the 100 threshold |
| `npx jscpd` on the 7 touched/new files, correct invocation (files as positional PATH args, `--pattern "**/*.{ts,js}"`) | 7 files analyzed, 0 clones — resolves this session's earlier jscpd invocation-syntax miss (comma-separated `--pattern` values don't work; positional paths do) |
| `grep -n standing_red_max swarmforge/swarmforge.conf` | both keys present (`standing_red_max_count 10`, `standing_red_max_age_days 7`) |
| `backlog/standing-reds.tsv` / `property_suite_standing_allowlist.tsv` | no data row owned by this ticket (one header-comment mention describing the mechanism) |
| leftover process/fixture check (`pgrep`, `git status --short`) | clean before and after every run |

**Stale `out/` note**: my first unit-test run failed with an unrelated-looking `ENOENT` and a 25/36 count before I ran `npm run compile` — the compiled `out/metrics/standingRedSignal.js` did not exist yet in my worktree. Not a defect; recompiling resolved it and all subsequent numbers matched prior evidence exactly.

## Independently re-confirmed the bounce fix's non-vacuity myself (not just trusted)

Backed up `emit-throttle-recommendation.ts`, reverted the clearing branch
to the pre-bounce bare `prior?.standingRed` truthiness check, recompiled,
and re-ran `emitThrottleRecommendationStandingRed.test.js`: the coder's
own bounce-regression test failed immediately, reproducing the exact
bounce finding — expected `/rework diagnosis cleared/`, got `"the red
count cleared - restoring the configured cap"`. Restored the file,
recompiled, confirmed byte-identical via `diff` and `git status --short`
(empty).

## BL-113 hard gherkin mutation: 15/20 killed, 5 confirmed EQUIVALENT

One `Scenario Outline` (scenario 01, 4 examples × 5 columns = 20
mutants, though only `count`/`age`/`unowned`/`cap`/`signal` are numeric
or text-mutable). Ran
`specs/pipeline/scripts/run_gherkin_mutation.sh <feature> <fresh mktemp
under ./tmp> specs/pipeline/steps/index.js hard`. Result: **15 killed, 5
survived**.

Read `standingRedSignal.ts` directly (not inferred) to check each
survivor against the actual comparison logic:

- `report.count > thresholds.maxCount` (strict greater-than)
- `report.oldest_age_days > thresholds.maxAgeDays` (strict greater-than)
- `report.unowned.length > 0` (any-nonzero check)
- `describeStandingRedSignal` returns a fixed string per signal type
  (`'count'`→`'the red count'`, `'age'`→`"the oldest red's age"`,
  `'unowned'`→`'an unowned red'`) — never embeds the numeric value

| mutant | mutation | why equivalent (from the code above) |
|---|---|---|
| m3 | example[0] `count`: 3 → 10 | both ≤ `maxCount` (10); the check is strict `>`, so 10 is still not over the threshold — same outcome (`none`) |
| m6 | example[1] `age`: 2 → 3 | both ≤ `maxAgeDays` (7); age is not the binding signal in this row anyway (count=11 already wins) |
| m8 | example[1] `count`: 11 → 16 | both > `maxCount` (10) — same outcome (cap 1, signal "the red count") |
| m16 | example[3] `age`: 2 → 6 | both ≤ `maxAgeDays` (7); age is not the binding signal in this row (unowned=1 already wins) |
| m20 | example[3] `unowned`: 1 → 8 | both satisfy `.length > 0` — the check is presence, not count, so any nonzero value is identical |

Each is demonstrable directly from the source's own strict-inequality and
presence-check logic (the BL-234 exception's own bar: "the code path
provably treats the whole value-class identically"), not argued from
resemblance. No artificial pinning assertion was added to force a false
kill of any of these — that would test the mutator's arbitrary
replacement value, not behavior. Recorded here per BL-234's discipline
(code-level reason, dated, not filed as settled beyond this evidence).

Per BL-502, the manifest's `scenarios: []` reflects these 5 unresolved
survivors (a scenario is only written when zero survivors AND zero
errors) — expected, not evidence the tool didn't run; the run's own
stdout status line (15 killed / 5 survived / 0 errors) is the
authoritative signal, read directly rather than from the manifest.

## Design/CRAP/DRY

Mutation-site-count within threshold on both changed TS files (94, 96).
jscpd (correctly invoked) confirms zero duplication across all 7
touched/new files.

## Verdict

No defect. Every BL-113 survivor is a genuine equivalent mutant,
independently confirmed against the real comparison logic. Forwarding to
documenter.
