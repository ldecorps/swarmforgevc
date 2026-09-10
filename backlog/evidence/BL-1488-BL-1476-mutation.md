# BL-1488 — hardener pass, 2026-09-11: the deferred BL-1476 Stryker run, discharged

## What ran

Merged architect's `252eea0d19` into this worktree (ancestor of coder
`c3a021a917`, cleaner `f4b939c652`). Cooldown re-checked live (per the
ticket's own warning that `not_before` arithmetic goes stale):

```
$ bb swarmforge/scripts/mutation_cooldown_gate.bb . extension/src/metrics/transcriptWalker.ts
DECISION: run
file_age_days: 2.90 (cooldown: 1 days)
load_avg: 1.43 cores: 20 busy_threshold: 2.00x (quiet)
```

All three files answered `DECISION: run`. `turnProfileProducer.ts` 2.87d,
`run-turn-profile-producer.ts` 2.90d, both quiet (1.43/20 cores).

Reproduced the coder's original run byte-for-byte before touching anything
(`npx stryker run stryker.bl1488.config.json --reporters clear-text,json
--concurrency 8`, load 1.56/20 at start): **400 killed / 120 survived / 54
no-coverage**, matching `backlog/evidence/BL-1488-coder-mutation-run1-20260910.md`
and the specifier's independent reproduction in
`backlog/evidence/BL-1488-survivor-census-specifier-20260911.md`.

## Scope of this pass (per the specifier's ruling, ticket `notes:` 2026-09-11)

- **turnProfileProducer.ts (31 survived/7 no-cov) + run-turn-profile-producer.ts
  (0/2) = 40**, plus **3 of transcriptWalker.ts's mutants on BL-1476's own
  lines** (`classifyTranscriptText` x2, `walkTranscriptText` x1) = **43
  mutants this pass's hardener in-pass chase**.
- **transcriptWalker.ts's remaining 131 mutants** (134 total minus the 3
  above) are **owned by BL-1523** (paused, tap pending) — untouched here,
  each row below says so.

## Work done (tests added/tightened, no production code changed)

All in `extension/test/turnProfileProducer.test.js`:

1. **`BL-1476-02d`** (new): a transcript deleted *mid-tick* — after the
   tick's own listing, before `resolveEntrySummary`'s per-entry `statOrNull`
   reaches it — via a `readFn` hook that unlinks the second path while
   reading the first. Distinct from the pre-existing `BL-1476-02c` (deletes
   *before* the tick starts, so the file is never even listed). Kills the
   `resolveEntrySummary`/`runTick` "gone" branch's real mutants: the `!stat`
   condition, its body, the `{kind:'gone'}` literal, and runTick's own
   `outcome.kind === 'gone'` check/string/body (ids 577/578/579/580/629/631/632).
2. **`BL-1476-04`** (new): a torn-tail transcript reaching the window record
   through `runTurnProfileProducer`/`runTick`/`accumulateEntrySummary` — the
   BL-1476 tick path — rather than through the pre-BL-1476
   `buildTurnProfileWindowForGroups` full-walk path every existing torn-tail
   test uses. Kills `accumulateEntrySummary`'s `if (summary.truncatedTail)`
   condition and body (ids 611/612).
3. **Barrel re-export test** (new): `TURN_PROFILE_SUMMARY_STORE_FILE` and
   `writeTranscriptSummaryStore` are re-exported from `turnProfileProducer`'s
   own barrel (BL-1476's doc comment) but nothing previously imported either
   *through* the barrel — `readTranscriptSummaryStore` and
   `turnProfileSummaryStorePath` were, leaving these two re-export getters'
   value/behavior mutants (as opposed to their enumerable-flag mutants,
   which stay equivalent regardless) dark. Kills ids
   463/464/466/475/476/478.
4. **Tightened `BL-1476-03`** (the deadline test): `opened.length <= 3` →
   `=== 3` (a loose upper bound cannot tell "fires immediately" from "never
   fires" apart from the real deadline check — both still satisfy `<= 3`),
   plus new assertions on `result.stages` (`[]`) and `result.complete`
   (`false`) on the partial-tick result. Kills the deadline-condition's
   real mutants: `&&`→`||`, the right-operand `>=` conditional/equality
   flips, and `partialProducerResult`'s hardcoded `stages`/`complete`
   literals (ids 589/592/594/651/652).

Re-ran the full scoped unit suite green (64/64:
`turnProfileProducer.test.js` 35, `transcriptWalker.test.js` 3,
`runTurnProfileProducer.test.js` 11, `transcriptSummaryStore.test.js` 15)
before recompiling and re-mutating.

## Result after hardening

```
$ npx stryker run stryker.bl1488.config.json --reporters clear-text,json --concurrency 8
Ran 4.68 tests per mutant on average.
-------------------------------|------------------|----------|-----------|------------|----------|----------|
                               | % Mutation score |          |           |            |          |          |
File                           |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
-------------------------------|--------|---------|----------|-----------|------------|----------|----------|
All files                      |  73.34 |   79.89 |      421 |         0 |        106 |       47 |        0 |
 metrics                       |  71.88 |   78.46 |      386 |         0 |        106 |       45 |        0 |
  transcriptWalker.js          |  58.77 |   68.21 |      191 |         0 |         89 |       45 |        0 |
  turnProfileProducer.js       |  91.98 |   91.98 |      195 |         0 |         17 |        0 |        0 |
 tools                         |  94.59 |  100.00 |       35 |         0 |          0 |        2 |        0 |
  run-turn-profile-producer.js |  94.59 |  100.00 |       35 |         0 |          0 |        2 |        0 |
-------------------------------|--------|---------|----------|-----------|------------|----------|----------|
```

`turnProfileProducer.js`: 38 → **17** unresolved (21 newly killed, 0
no-coverage remaining). `run-turn-profile-producer.js`: unchanged at 2
no-coverage (both `main()`'s own body, re-affirmed equivalent — see below).
`transcriptWalker.js`: unchanged at 89/45=134 (expected — no test in
`transcriptWalker.test.js` was touched; the 3 in-pass mutants there are
reasoned equivalent below without a new test, and the other 131 are
BL-1523's).

## Every remaining survivor/no-coverage mutant has a reason (Article 4.4 shape)

Survivors: 153

- `out/metrics/transcriptWalker.js:68:27` Regex Survived in GIT_MECHANICAL_RE — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:69:21` Regex Survived in TEST_RUN_RE — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:70:28` Regex Survived in PROVIDER_OUTAGE_RE — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:70:28` Regex Survived in PROVIDER_OUTAGE_RE — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:73:31` StringLiteral Survived in INTERVAL_KIND_TO_CATEGORY — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:74:33` StringLiteral Survived in INTERVAL_KIND_TO_CATEGORY — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:75:34` StringLiteral Survived in INTERVAL_KIND_TO_CATEGORY — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:80:43` MethodExpression Survived in classifyIntervalKind — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:81:9` ConditionalExpression Survived in classifyIntervalKind — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:81:15` BlockStatement NoCoverage in classifyIntervalKind — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:82:25` StringLiteral NoCoverage in classifyIntervalKind — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:87:9` ConditionalExpression Survived in classifyShellCommand — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:87:42` BlockStatement Survived in classifyShellCommand — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:90:9` ConditionalExpression Survived in classifyShellCommand — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:93:9` ConditionalExpression Survived in classifyShellCommand — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:93:9` ConditionalExpression Survived in classifyShellCommand — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:93:43` BlockStatement NoCoverage in classifyShellCommand — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:94:16` StringLiteral NoCoverage in classifyShellCommand — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:96:12` StringLiteral Survived in classifyShellCommand — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:100:30` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:100:40` StringLiteral Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:103:9` LogicalOperator Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:103:9` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:103:9` LogicalOperator Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:103:9` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:103:9` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:103:19` StringLiteral Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:103:29` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:103:39` StringLiteral Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:103:49` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:103:59` StringLiteral Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:103:67` BlockStatement Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:104:16` StringLiteral Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:106:9` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:106:9` LogicalOperator Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:106:9` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:106:9` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:106:9` LogicalOperator Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:106:9` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:106:9` EqualityOperator Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:106:19` StringLiteral Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:106:30` ConditionalExpression NoCoverage in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:106:30` EqualityOperator NoCoverage in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:106:40` StringLiteral NoCoverage in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:106:56` ConditionalExpression NoCoverage in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:106:56` EqualityOperator NoCoverage in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:106:66` StringLiteral NoCoverage in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:106:82` BlockStatement Survived in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:109:9` ConditionalExpression NoCoverage in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:109:9` ConditionalExpression NoCoverage in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:109:45` BlockStatement NoCoverage in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:110:16` StringLiteral NoCoverage in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:112:12` StringLiteral NoCoverage in classifyToolName — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:115:9` ConditionalExpression Survived in parseTimestampMs — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:115:34` BlockStatement NoCoverage in parseTimestampMs — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:124:16` ArrayDeclaration Survived in toolBlocks — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:126:12` MethodExpression Survived in toolBlocks — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:126:38` ConditionalExpression Survived in toolBlocks — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:126:38` LogicalOperator Survived in toolBlocks — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:126:47` ConditionalExpression Survived in toolBlocks — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:129:9` ConditionalExpression Survived in inputAsText — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:129:26` StringLiteral Survived in inputAsText — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:129:36` BlockStatement NoCoverage in inputAsText — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:132:9` ConditionalExpression Survived in inputAsText — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:132:9` LogicalOperator Survived in inputAsText — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:132:18` ConditionalExpression Survived in inputAsText — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:136:15` BlockStatement NoCoverage in inputAsText — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:137:20` StringLiteral NoCoverage in inputAsText — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:140:12` StringLiteral NoCoverage in inputAsText — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:143:9` ConditionalExpression Survived in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:143:10` MethodExpression Survived in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:143:23` BlockStatement NoCoverage in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:144:16` ArrayDeclaration NoCoverage in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:150:11` BlockStatement NoCoverage in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:151:16` ArrayDeclaration NoCoverage in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:154:9` ConditionalExpression Survived in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:154:36` BlockStatement NoCoverage in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:155:16` ArrayDeclaration NoCoverage in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:160:13` ConditionalExpression Survived in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:160:40` BlockStatement NoCoverage in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:163:22` ConditionalExpression Survived in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:163:68` StringLiteral NoCoverage in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:172:9` ConditionalExpression Survived in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:172:9` ConditionalExpression Survived in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:172:9` EqualityOperator Survived in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:172:25` StringLiteral Survived in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:172:66` OptionalChaining NoCoverage in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:172:84` BlockStatement NoCoverage in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:173:24` ObjectLiteral NoCoverage in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:174:23` StringLiteral NoCoverage in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:176:20` ArithmeticOperator NoCoverage in classifyLine — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:184:13` ConditionalExpression Survived in parseTimedEvents — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:184:14` MethodExpression Survived in parseTimedEvents — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:184:27` BlockStatement Survived in parseTimedEvents — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:195:13` ConditionalExpression Survived in parseTimedEvents — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:195:40` BlockStatement NoCoverage in parseTimedEvents — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:198:22` ConditionalExpression Survived in parseTimedEvents — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:198:70` StringLiteral NoCoverage in parseTimedEvents — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:215:13` ConditionalExpression Survived in overheadIntervals — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:215:13` LogicalOperator Survived in overheadIntervals — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:215:13` ConditionalExpression Survived in overheadIntervals — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:215:40` ConditionalExpression Survived in overheadIntervals — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:215:40` EqualityOperator Survived in overheadIntervals — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:217:17` ConditionalExpression Survived in overheadIntervals — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:217:17` EqualityOperator Survived in overheadIntervals — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:231:43` ConditionalExpression Survived in attributeTrail — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:231:43` LogicalOperator Survived in attributeTrail — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:231:43` ConditionalExpression Survived in attributeTrail — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:231:43` EqualityOperator Survived in attributeTrail — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:231:75` ConditionalExpression Survived in attributeTrail — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:231:75` EqualityOperator Survived in attributeTrail — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:255:13` EqualityOperator Survived in coverageFromIntervals — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:258:13` EqualityOperator Survived in coverageFromIntervals — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:290:9` ConditionalExpression Survived in classifyTranscriptText — accepted equivalent: same `badIndexes.length===1 && badIndexes[0]===lines.length-1` redundant-conjunct class BL-1364 already confirmed (forEach builds badIndexes ascending, so badIndexes[0] is always the smallest — forcing the length check true changes nothing) — reused, code identical since that pass — BL-1488 in-pass
- `out/metrics/transcriptWalker.js:293:47` BooleanLiteral Survived in classifyTranscriptText — accepted equivalent: the `truncatedTail: false` value on the (unreadable:true) return is never read by any caller — both call sites (turnProfileProducer.ts assessTranscriptReadability and accumulateEntrySummary, transcriptSummaryStore.ts computeTranscriptSummary) only inspect `.truncatedTail` inside the branch gated on `.unreadable===false` — BL-1488 in-pass
- `out/metrics/transcriptWalker.js:306:50` ArrayDeclaration Survived in walkTranscriptText — accepted equivalent: `handoffTrail = []` default-param mutant — attributeTrail's find() reads `.startMs` off each trail entry, so a malformed non-empty default never matches (same reasoning BL-1364 confirmed for the sibling `?? []` fallback) — BL-1488 in-pass
- `out/metrics/transcriptWalker.js:315:62` ArrayDeclaration Survived in walkTranscriptFiles — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:317:27` ArrayDeclaration Survived in walkTranscriptFiles — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:319:13` ConditionalExpression Survived in walkTranscriptFiles — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:319:39` BlockStatement NoCoverage in walkTranscriptFiles — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:336:13` ConditionalExpression Survived in snapshotTranscriptFiles — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:343:45` BlockStatement Survived in transcriptsUnchanged — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:344:13` ConditionalExpression Survived in transcriptsUnchanged — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:344:39` BlockStatement NoCoverage in transcriptsUnchanged — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:345:17` ConditionalExpression NoCoverage in transcriptsUnchanged — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:345:17` ConditionalExpression NoCoverage in transcriptsUnchanged — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:345:39` BlockStatement NoCoverage in transcriptsUnchanged — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:346:24` BooleanLiteral NoCoverage in transcriptsUnchanged — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:351:13` ConditionalExpression Survived in transcriptsUnchanged — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:351:34` BlockStatement NoCoverage in transcriptsUnchanged — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:352:20` BooleanLiteral NoCoverage in transcriptsUnchanged — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:354:13` ConditionalExpression Survived in transcriptsUnchanged — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:354:58` BlockStatement NoCoverage in transcriptsUnchanged — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/transcriptWalker.js:355:20` BooleanLiteral NoCoverage in transcriptsUnchanged — owned by BL-1523 (first-run debt on transcriptWalker.ts, not chased in this parcel per the specifier's ruling, BL-1488 notes 2026-09-11)
- `out/metrics/turnProfileProducer.js:53:81` BooleanLiteral Survived in transcriptSummaryStore_2 — accepted equivalent: barrel re-export enumerable-flag mutant, unobservable via any destructure/property access (only for...in/Object.keys/spread would see it, and nothing does) — BL-1488
- `out/metrics/turnProfileProducer.js:54:77` BooleanLiteral Survived in transcriptSummaryStore_2 — accepted equivalent: barrel re-export enumerable-flag mutant, unobservable via any destructure/property access (only for...in/Object.keys/spread would see it, and nothing does) — BL-1488
- `out/metrics/turnProfileProducer.js:55:76` BooleanLiteral Survived in transcriptSummaryStore_2 — accepted equivalent: barrel re-export enumerable-flag mutant, unobservable via any destructure/property access (only for...in/Object.keys/spread would see it, and nothing does) — BL-1488
- `out/metrics/turnProfileProducer.js:56:77` BooleanLiteral Survived in transcriptSummaryStore_2 — accepted equivalent: barrel re-export enumerable-flag mutant, unobservable via any destructure/property access (only for...in/Object.keys/spread would see it, and nothing does) — BL-1488
- `out/metrics/turnProfileProducer.js:167:23` ConditionalExpression Survived in buildTurnProfileWindowRecord — accepted equivalent: pre-existing, code unchanged since BL-1364 confirmed this exact mutant equivalent by hand-mutation (backlog/evidence/BL-1364-hardener-pass-20260905.md) — reused, re-verified via diff showing the lines untouched
- `out/metrics/turnProfileProducer.js:167:47` ArrayDeclaration Survived in buildTurnProfileWindowRecord — accepted equivalent: pre-existing, code unchanged since BL-1364 confirmed this exact mutant equivalent by hand-mutation (backlog/evidence/BL-1364-hardener-pass-20260905.md) — reused, re-verified via diff showing the lines untouched
- `out/metrics/turnProfileProducer.js:167:129` ArrayDeclaration Survived in buildTurnProfileWindowRecord — accepted equivalent: pre-existing, code unchanged since BL-1364 confirmed this exact mutant equivalent by hand-mutation (backlog/evidence/BL-1364-hardener-pass-20260905.md) — reused, re-verified via diff showing the lines untouched
- `out/metrics/turnProfileProducer.js:190:13` ConditionalExpression Survived in buildTurnProfileWindowForGroups — accepted equivalent: pre-existing, code unchanged since BL-1364 confirmed this exact mutant equivalent by hand-mutation (backlog/evidence/BL-1364-hardener-pass-20260905.md) — reused, re-verified via diff showing the lines untouched
- `out/metrics/turnProfileProducer.js:190:48` BlockStatement Survived in buildTurnProfileWindowForGroups — accepted equivalent: pre-existing, code unchanged since BL-1364 confirmed this exact mutant equivalent by hand-mutation (backlog/evidence/BL-1364-hardener-pass-20260905.md) — reused, re-verified via diff showing the lines untouched
- `out/metrics/turnProfileProducer.js:201:36` StringLiteral Survived in windowDedupeKey — accepted equivalent: pre-existing, code unchanged since BL-1364 confirmed this exact mutant equivalent by hand-mutation (backlog/evidence/BL-1364-hardener-pass-20260905.md) — reused, re-verified via diff showing the lines untouched
- `out/metrics/turnProfileProducer.js:232:116` StringLiteral Survived in upsertWindowRecord — accepted equivalent: pre-existing, code unchanged since BL-1364 confirmed this exact mutant equivalent by hand-mutation (backlog/evidence/BL-1364-hardener-pass-20260905.md) — reused, re-verified via diff showing the lines untouched
- `out/metrics/turnProfileProducer.js:285:24` StringLiteral Survived in resolveEntrySummary — accepted equivalent: the `kind: 'summary'` tag mutant — only 'deadline' and 'gone' are ever checked by callers (runTick), so any third tag value is an unobserved implicit fallthrough (BL-1083 union-tag class) — BL-1488
- `out/metrics/turnProfileProducer.js:287:9` ConditionalExpression Survived in resolveEntrySummary — accepted equivalent: forcing `deadlineAtMs !== undefined` (or its NaN-producing sibling at resolveProducerTickOptions:355) true only matters when deadlineAtMs is genuinely undefined, and `n >= undefined`/`n >= NaN` is always false in JS either way — same outcome as the original short-circuit — BL-1488
- `out/metrics/turnProfileProducer.js:290:20` StringLiteral Survived in resolveEntrySummary — accepted equivalent: same union-tag fallthrough as line 285 ('summary' kind never checked) — BL-1488
- `out/metrics/turnProfileProducer.js:320:72` BooleanLiteral Survived in runTick — accepted equivalent: `partial: true` -> false on runTick's own deadline-branch return is masked by the caller: runTurnProfileProducer's `if (outcome.partial || !outcome.record)` guard is already true from `!outcome.record` (record is null exactly when partial, by TickOutcome's own invariant), and partialProducerResult hardcodes `partial: true` on its result regardless of the input field — BL-1488
- `out/metrics/turnProfileProducer.js:355:26` ConditionalExpression Survived in resolveProducerTickOptions — accepted equivalent: forcing `params.deadlineMs !== undefined` true only changes behavior when deadlineMs is omitted, in which case the resulting `deadlineAtMs` is NaN instead of undefined — but `nowFn() >= NaN` is always false, identical to the original's short-circuited false — BL-1488
- `out/metrics/turnProfileProducer.js:383:9` LogicalOperator Survived in runTurnProfileProducer — accepted equivalent: `outcome.partial || !outcome.record` -> `&&` is unobservable because partial and !record always agree (TickOutcome's own invariant: record is null exactly when the tick stopped at its deadline) — BL-1488
- `out/tools/run-turn-profile-producer.js:49:17` BlockStatement NoCoverage in main — accepted equivalent (re-affirmed): main()'s own thin-CLI-wrapper body, no in-process seam for resolveCliMainWorktreeContext/console.log; BL-1364 accepted the same 2 no-coverage mutants on 2026-09-05 under engineering.prompt's CLI thin-wrapper convention — BL-1488
- `out/tools/run-turn-profile-producer.js:51:70` ObjectLiteral NoCoverage in main — accepted equivalent (re-affirmed): main()'s own thin-CLI-wrapper body, no in-process seam for resolveCliMainWorktreeContext/console.log; BL-1364 accepted the same 2 no-coverage mutants on 2026-09-05 under engineering.prompt's CLI thin-wrapper convention — BL-1488

## Load and duration

Load: 1.56/20 cores at start of the reproduction run (quiet; well under the
2x/40 busy threshold); 1.36/20 at start of the post-hardening re-run.
Duration: 25 seconds (post-hardening re-run; the reproduction run was 27s).

## Invariants (BL-654)

1. *"A ledger row leaves the outstanding debt only through a discharge that
   names the gate, the parcel and a committed result; a run that cannot
   complete is recorded as an attempt with its blocker and the row stays
   outstanding and owned."* Honoured: the run completed (25s, no timeout,
   no dry-run failure) and every one of its 153 remaining survivor/no-cov
   mutants carries a reason: 22 accepted-equivalent (19 from this pass's
   in-pass chase of turnProfileProducer.ts/run-turn-profile-producer.ts,
   3 from transcriptWalker.ts's own in-pass mutants) and 131 owned by
   BL-1523 (transcriptWalker.ts's first-run debt) — a reason per survivor,
   not zero survivors, which is exactly what the accepted discharge rule
   (hardender.prompt, a17bc78d43) requires. So the row discharges on this
   result.
2. *"The register row leaves in the same commit that discharges the ledger
   row, never earlier."* The `hardening_debt_ledger_update.bb --discharge`
   call and the register-row removal it triggers land in this same commit.

## Discharge

```
$ bb swarmforge/scripts/hardening_debt_ledger_update.bb . --discharge BL-1476 mutation --evidence backlog/evidence/BL-1488-BL-1476-mutation.md
discharged mutation for BL-1476
```

By hardender.
