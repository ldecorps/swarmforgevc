# BL-1488 — survivor census over the BL-1476 deferred-gate run, specifier, 2026-09-11

Specifier record, made while answering the coder's note of 2026-09-10T22:43Z
("BL-1488: 174 unresolved mutants found, not low-cost, see coder evidence",
inbound `00_20260910T224317Z_001864_from_coder_to_specifier`) and the
coordinator's companion note of the same minute ("BL-1488 premise false: 174
unresolved mutants, not low-cost discharge"). The coder's own run is
`backlog/evidence/BL-1488-coder-mutation-run1-20260910.md` on the coder tip
`c3a021a917`. This file is the partition basis for the ruling recorded in
BL-1488's `notes:` and for the owner ticket minted with it (BL-1523).

## Reproduction (exact commands)

The coder's config carries no per-mutant reporter, so the run was repeated
unchanged with a JSON reporter added, in the coder's compiled worktree
(`out/` compiled 2026-09-10 23:33 at `c3a021a917`, source identical to
`main` `08fd65f011`):

```
cd .worktrees/coder/extension
npx stryker run stryker.bl1488.config.json --reporters clear-text,json
# 00:05 BST 2026-09-11, load 1.20/20 cores at start, 719 mutants instrumented,
# 4.46 tests per mutant. Result byte-for-byte the coder's summary:
#   All files                     69.69 | 76.92 | 400 killed | 120 survived | 54 no-cov
#   transcriptWalker.js           58.77 | 68.21 | 191 | 89 | 45
#   turnProfileProducer.js        82.08 | 84.88 | 174 | 31 |  7
#   run-turn-profile-producer.js  94.59 |100.00 |  35 |  0 |  2
```

Census: each Survived/NoCoverage mutant in
`reports/mutation/mutation.json` attributed to the enclosing top-level
declaration of the compiled file at the line Stryker reported (same method
as `backlog/evidence/BL-1519-first-run-survivor-census-20260910.md`; the
script is at the end of this file). Provenance: `git blame -l` on the
TypeScript source, per function, counting lines by commit.

## Caveats

- `NoCoverage` is measured against the row's SCOPED include set
  (`vitest.bl1476.stryker.config.mjs`: `transcriptWalker.test.js`,
  `turnProfileProducer.test.js`, `runTurnProfileProducer.test.js`,
  `transcriptSummaryStore.test.js`), not the full unit suite. An owner
  slice re-measures over the full suite before calling one a gap.
- The 10 mutants attributed to `transcriptSummaryStore_2` in
  `turnProfileProducer.js` sit on compiled re-export getters
  (`Object.defineProperty(exports, "<name>", { get })`, out lines 53-56, for
  the four value re-exports from `transcriptSummaryStore.ts`) — the
  barrel-export class BL-1468 met. They are BL-1476's lines.
- `run-turn-profile-producer.js`'s 2 no-coverage mutants are `main()`'s own
  body. BL-1364's hardener pass (2026-09-05) reported the same 2 and accepted
  them as the thin wrapper itself.

## This is NOT a first run, and most of it is NOT pre-existing debt

`backlog/evidence/BL-1364-hardener-pass-20260905.md` ran scoped Stryker on
all three files on 2026-09-05: it hardened `turnProfileProducer.js` (then
301 lines) to 9 survivors, all confirmed equivalent, 0 no-coverage; it
recorded `transcriptWalker.js` at **94 survivors, "pre-existing, out of
scope"**, cross-referenced to code BL-1364 did not touch (`classifyToolName`,
`classifyLine`, ...). So transcriptWalker's debt was measured and left
unowned once already; this pass is where it gets an owner.

BL-1476 then rewrote turnProfileProducer (its coder commit `49a716ed2a`
+267/-128 on that file; its hardener commit `55b3eda9d3`) and was the
parcel whose gate the cooldown deferred. Per-function blame on `main`:

### turnProfileProducer.js — 31 survived / 7 no-coverage (281 mutants)

| Function | s/n | Source lines | Blame | Class |
|---|---|---|---|---|
| resolveEntrySummary | 7/3 | L335-354 | 55b3eda9d3 (BL-1476 hardener) 19, 49a716ed2a 1 | BL-1476's own lines |
| re-export getters (`transcriptSummaryStore_2`) | 8/2 | out L53-56 | BL-1476 (new store module) | BL-1476's own lines |
| runTick | 3/1 | L386-420 | 55b3eda9d3 28, 49a716ed2a 7 | BL-1476's own lines |
| accumulateEntrySummary | 1/1 | L375-384 | 55b3eda9d3 10 | BL-1476's own lines |
| resolveProducerTickOptions | 2/0 | L447-451 | 55b3eda9d3 5 | BL-1476's own lines |
| partialProducerResult | 2/0 | L458-460 | 55b3eda9d3 3 | BL-1476's own lines |
| buildTurnProfileWindowRecord | 3/0 | L183-186 | 3ffe6092e5 (BL-1364) | pre-existing (BL-1364's 9 equivalents) |
| buildTurnProfileWindowForGroups | 2/0 | L210-226 | fcc6d0a064 14, 3ffe6092e5 3 | pre-existing |
| windowDedupeKey | 1/0 | L229-231 | fcc6d0a064 | pre-existing |
| upsertWindowRecord | 1/0 | L264-275 | fcc6d0a064 | pre-existing |
| runTurnProfileProducer | 1/0 | L474-482 | fcc6d0a064 6, 49a716ed2a 3 | pre-existing (body) |

**30 of 38 sit on BL-1476's own lines.** Under hardender.prompt's accepted
rule (a17bc78d43, item 2: "survivors on the deferred parcel's own changed
lines are the gate that was owed, not pre-existing debt ... chase those
in-pass regardless of the threshold" when the mapping is cheap — it is, this
table is the mapping), these are BL-1488's hardener's to chase in-pass. The
remaining 8, plus the CLI's 2, are under the ~50 in-pass default and were
at 9-equivalents-and-2-accepted on 2026-09-05, so the whole file pair (40)
is chased in-pass in BL-1488; nothing here needs an owner ticket unless the
hardener's evidence leaves some neither killed nor accepted-equivalent, in
which case its `unowned-survivors` note mints one.

### run-turn-profile-producer.js — 0 survived / 2 no-coverage (44 mutants)

| Function | s/n | Class |
|---|---|---|
| main | 0/2 | thin CLI wrapper body; BL-1364 accepted the same 2 on 2026-09-05. Kill via the in-process `main()` seam (engineering.prompt "CLI main() is a thin wrapper") or re-accept with the reason — in-pass, BL-1488. |

### transcriptWalker.js — 89 survived / 45 no-coverage (394 mutants)

Blame: every function below is `97a0aab83b` (BL-664, 2026-08-27) except
`coverageFromIntervals` (11/16 lines BL-1364), `classifyTranscriptText` and
`walkTranscriptText` (all BL-1476, `49a716ed2a`) and `walkTranscriptFiles`
(3/22 lines BL-1476).

| Function | s/n | Group |
|---|---|---|
| classifyToolName | 23/11 | classification |
| classifyLine | 9/13 | classification |
| transcriptsUnchanged | 4/9 | snapshot |
| inputAsText | 5/4 | classification |
| classifyShellCommand | 6/2 | classification |
| parseTimedEvents | 5/2 | intervals |
| overheadIntervals | 7/0 | intervals |
| attributeTrail | 6/0 | intervals |
| toolBlocks | 5/0 | classification |
| classifyIntervalKind | 2/2 | intervals |
| walkTranscriptFiles | 3/1 | walk |
| INTERVAL_KIND_TO_CATEGORY | 3/0 | module-level table |
| parseTimestampMs | 1/1 | intervals |
| coverageFromIntervals | 2/0 | intervals |
| classifyTranscriptText | 2/0 | BL-1476's own lines |
| PROVIDER_OUTAGE_RE | 2/0 | module-level table |
| walkTranscriptText | 1/0 | BL-1476's own lines |
| snapshotTranscriptFiles | 1/0 | snapshot |
| TEST_RUN_RE | 1/0 | module-level table |
| GIT_MECHANICAL_RE | 1/0 | module-level table |

Partition used by BL-1523 (owner): **45 no-coverage** (classifyLine 13,
classifyToolName 11, transcriptsUnchanged 9, inputAsText 4,
classifyShellCommand 2, parseTimedEvents 2, classifyIntervalKind 2,
walkTranscriptFiles 1, parseTimestampMs 1) + **7 module-level table
survivors** (INTERVAL_KIND_TO_CATEGORY 3, PROVIDER_OUTAGE_RE 2, TEST_RUN_RE 1,
GIT_MECHANICAL_RE 1) = **52 chased to zero**; **82 survived in function
bodies** carry a recorded disposition under the human's BL-1519 ruling
(grandfathered, guarded by the BL-1164 changed-path gate) unless the
BL-1523 tap picks the other ruling option, in which case the specifier mints
a successor slice for them (classification group 48: classifyToolName 23,
classifyLine 9, classifyShellCommand 6, inputAsText 5, toolBlocks 5;
intervals-and-walk group 34: overheadIntervals 7, attributeTrail 6,
parseTimedEvents 5, transcriptsUnchanged 4, walkTranscriptFiles 3,
classifyIntervalKind 2, coverageFromIntervals 2, classifyTranscriptText 2,
parseTimestampMs 1, walkTranscriptText 1, snapshotTranscriptFiles 1). The 3
on BL-1476's own lines (classifyTranscriptText 2, walkTranscriptText 1) are
BL-1488's hardener's in-pass per item 2 above; BL-1523's re-measure takes
whatever remains.

## Disposition per mutant (174 rows)

One row per Survived/NoCoverage mutant at `c3a021a917`, the shape the
BL-1488 step handler counts (`^- ` lines >= the `Survivors:` count). The
hardener's discharge evidence carries its own copy of these rows with the
final verb per row (killed in this pass / accepted equivalent + proof /
first-run debt owned by BL-1523).

- `out/metrics/transcriptWalker.js:68:27` Regex Survived in GIT_MECHANICAL_RE — owned by BL-1523 (module-level table, chased to zero)
- `out/metrics/transcriptWalker.js:69:21` Regex Survived in TEST_RUN_RE — owned by BL-1523 (module-level table, chased to zero)
- `out/metrics/transcriptWalker.js:70:28` Regex Survived in PROVIDER_OUTAGE_RE — owned by BL-1523 (module-level table, chased to zero)
- `out/metrics/transcriptWalker.js:70:28` Regex Survived in PROVIDER_OUTAGE_RE — owned by BL-1523 (module-level table, chased to zero)
- `out/metrics/transcriptWalker.js:73:31` StringLiteral Survived in INTERVAL_KIND_TO_CATEGORY — owned by BL-1523 (module-level table, chased to zero)
- `out/metrics/transcriptWalker.js:74:33` StringLiteral Survived in INTERVAL_KIND_TO_CATEGORY — owned by BL-1523 (module-level table, chased to zero)
- `out/metrics/transcriptWalker.js:75:34` StringLiteral Survived in INTERVAL_KIND_TO_CATEGORY — owned by BL-1523 (module-level table, chased to zero)
- `out/metrics/transcriptWalker.js:80:43` MethodExpression Survived in classifyIntervalKind — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:81:9` ConditionalExpression Survived in classifyIntervalKind — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:81:15` BlockStatement NoCoverage in classifyIntervalKind — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:82:25` StringLiteral NoCoverage in classifyIntervalKind — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:87:9` ConditionalExpression Survived in classifyShellCommand — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:87:42` BlockStatement Survived in classifyShellCommand — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:90:9` ConditionalExpression Survived in classifyShellCommand — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:93:9` ConditionalExpression Survived in classifyShellCommand — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:93:9` ConditionalExpression Survived in classifyShellCommand — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:93:43` BlockStatement NoCoverage in classifyShellCommand — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:94:16` StringLiteral NoCoverage in classifyShellCommand — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:96:12` StringLiteral Survived in classifyShellCommand — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:100:30` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:100:40` StringLiteral Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:103:9` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:103:9` LogicalOperator Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:103:9` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:103:9` LogicalOperator Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:103:9` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:103:19` StringLiteral Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:103:29` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:103:39` StringLiteral Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:103:49` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:103:59` StringLiteral Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:103:67` BlockStatement Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:104:16` StringLiteral Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:106:9` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:106:9` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:106:9` LogicalOperator Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:106:9` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:106:9` LogicalOperator Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:106:9` ConditionalExpression Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:106:9` EqualityOperator Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:106:19` StringLiteral Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:106:30` ConditionalExpression NoCoverage in classifyToolName — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:106:30` EqualityOperator NoCoverage in classifyToolName — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:106:40` StringLiteral NoCoverage in classifyToolName — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:106:56` ConditionalExpression NoCoverage in classifyToolName — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:106:56` EqualityOperator NoCoverage in classifyToolName — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:106:66` StringLiteral NoCoverage in classifyToolName — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:106:82` BlockStatement Survived in classifyToolName — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:109:9` ConditionalExpression NoCoverage in classifyToolName — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:109:9` ConditionalExpression NoCoverage in classifyToolName — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:109:45` BlockStatement NoCoverage in classifyToolName — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:110:16` StringLiteral NoCoverage in classifyToolName — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:112:12` StringLiteral NoCoverage in classifyToolName — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:115:9` ConditionalExpression Survived in parseTimestampMs — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:115:34` BlockStatement NoCoverage in parseTimestampMs — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:124:16` ArrayDeclaration Survived in toolBlocks — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:126:12` MethodExpression Survived in toolBlocks — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:126:38` ConditionalExpression Survived in toolBlocks — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:126:38` LogicalOperator Survived in toolBlocks — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:126:47` ConditionalExpression Survived in toolBlocks — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:129:9` ConditionalExpression Survived in inputAsText — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:129:26` StringLiteral Survived in inputAsText — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:129:36` BlockStatement NoCoverage in inputAsText — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:132:9` ConditionalExpression Survived in inputAsText — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:132:9` LogicalOperator Survived in inputAsText — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:132:18` ConditionalExpression Survived in inputAsText — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:136:15` BlockStatement NoCoverage in inputAsText — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:137:20` StringLiteral NoCoverage in inputAsText — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:140:12` StringLiteral NoCoverage in inputAsText — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:143:9` ConditionalExpression Survived in classifyLine — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:143:10` MethodExpression Survived in classifyLine — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:143:23` BlockStatement NoCoverage in classifyLine — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:144:16` ArrayDeclaration NoCoverage in classifyLine — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:150:11` BlockStatement NoCoverage in classifyLine — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:151:16` ArrayDeclaration NoCoverage in classifyLine — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:154:9` ConditionalExpression Survived in classifyLine — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:154:36` BlockStatement NoCoverage in classifyLine — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:155:16` ArrayDeclaration NoCoverage in classifyLine — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:160:13` ConditionalExpression Survived in classifyLine — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:160:40` BlockStatement NoCoverage in classifyLine — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:163:22` ConditionalExpression Survived in classifyLine — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:163:68` StringLiteral NoCoverage in classifyLine — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:172:9` ConditionalExpression Survived in classifyLine — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:172:9` ConditionalExpression Survived in classifyLine — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:172:9` EqualityOperator Survived in classifyLine — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:172:25` StringLiteral Survived in classifyLine — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:172:66` OptionalChaining NoCoverage in classifyLine — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:172:84` BlockStatement NoCoverage in classifyLine — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:173:24` ObjectLiteral NoCoverage in classifyLine — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:174:23` StringLiteral NoCoverage in classifyLine — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:176:20` ArithmeticOperator NoCoverage in classifyLine — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:184:13` ConditionalExpression Survived in parseTimedEvents — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:184:14` MethodExpression Survived in parseTimedEvents — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:184:27` BlockStatement Survived in parseTimedEvents — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:195:13` ConditionalExpression Survived in parseTimedEvents — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:195:40` BlockStatement NoCoverage in parseTimedEvents — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:198:22` ConditionalExpression Survived in parseTimedEvents — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:198:70` StringLiteral NoCoverage in parseTimedEvents — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:215:13` ConditionalExpression Survived in overheadIntervals — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:215:13` LogicalOperator Survived in overheadIntervals — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:215:13` ConditionalExpression Survived in overheadIntervals — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:215:40` ConditionalExpression Survived in overheadIntervals — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:215:40` EqualityOperator Survived in overheadIntervals — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:217:17` ConditionalExpression Survived in overheadIntervals — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:217:17` EqualityOperator Survived in overheadIntervals — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:231:43` ConditionalExpression Survived in attributeTrail — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:231:43` LogicalOperator Survived in attributeTrail — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:231:43` ConditionalExpression Survived in attributeTrail — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:231:43` EqualityOperator Survived in attributeTrail — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:231:75` ConditionalExpression Survived in attributeTrail — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:231:75` EqualityOperator Survived in attributeTrail — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:255:13` EqualityOperator Survived in coverageFromIntervals — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:258:13` EqualityOperator Survived in coverageFromIntervals — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:290:9` ConditionalExpression Survived in classifyTranscriptText — BL-1476's own lines: BL-1488 hardener in-pass; owner BL-1523 if it remains
- `out/metrics/transcriptWalker.js:293:47` BooleanLiteral Survived in classifyTranscriptText — BL-1476's own lines: BL-1488 hardener in-pass; owner BL-1523 if it remains
- `out/metrics/transcriptWalker.js:306:50` ArrayDeclaration Survived in walkTranscriptText — BL-1476's own lines: BL-1488 hardener in-pass; owner BL-1523 if it remains
- `out/metrics/transcriptWalker.js:315:62` ArrayDeclaration Survived in walkTranscriptFiles — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:317:27` ArrayDeclaration Survived in walkTranscriptFiles — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:319:13` ConditionalExpression Survived in walkTranscriptFiles — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:319:39` BlockStatement NoCoverage in walkTranscriptFiles — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:336:13` ConditionalExpression Survived in snapshotTranscriptFiles — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:343:45` BlockStatement Survived in transcriptsUnchanged — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:344:13` ConditionalExpression Survived in transcriptsUnchanged — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:344:39` BlockStatement NoCoverage in transcriptsUnchanged — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:345:17` ConditionalExpression NoCoverage in transcriptsUnchanged — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:345:17` ConditionalExpression NoCoverage in transcriptsUnchanged — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:345:39` BlockStatement NoCoverage in transcriptsUnchanged — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:346:24` BooleanLiteral NoCoverage in transcriptsUnchanged — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:351:13` ConditionalExpression Survived in transcriptsUnchanged — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:351:34` BlockStatement NoCoverage in transcriptsUnchanged — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:352:20` BooleanLiteral NoCoverage in transcriptsUnchanged — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:354:13` ConditionalExpression Survived in transcriptsUnchanged — owned by BL-1523 (function-body survivor, disposition per the BL-1519 ruling)
- `out/metrics/transcriptWalker.js:354:58` BlockStatement NoCoverage in transcriptsUnchanged — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/transcriptWalker.js:355:20` BooleanLiteral NoCoverage in transcriptsUnchanged — owned by BL-1523 (no-coverage, chased to zero)
- `out/metrics/turnProfileProducer.js:53:32` StringLiteral Survived in transcriptSummaryStore_2 — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:53:67` ObjectLiteral Survived in transcriptSummaryStore_2 — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:53:81` BooleanLiteral Survived in transcriptSummaryStore_2 — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:53:104` BlockStatement NoCoverage in transcriptSummaryStore_2 — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:54:77` BooleanLiteral Survived in transcriptSummaryStore_2 — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:55:76` BooleanLiteral Survived in transcriptSummaryStore_2 — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:56:32` StringLiteral Survived in transcriptSummaryStore_2 — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:56:63` ObjectLiteral Survived in transcriptSummaryStore_2 — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:56:77` BooleanLiteral Survived in transcriptSummaryStore_2 — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:56:100` BlockStatement NoCoverage in transcriptSummaryStore_2 — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:167:23` ConditionalExpression Survived in buildTurnProfileWindowRecord — pre-existing (BL-1364 equivalents): BL-1488 hardener in-pass (under-50 default)
- `out/metrics/turnProfileProducer.js:167:47` ArrayDeclaration Survived in buildTurnProfileWindowRecord — pre-existing (BL-1364 equivalents): BL-1488 hardener in-pass (under-50 default)
- `out/metrics/turnProfileProducer.js:167:129` ArrayDeclaration Survived in buildTurnProfileWindowRecord — pre-existing (BL-1364 equivalents): BL-1488 hardener in-pass (under-50 default)
- `out/metrics/turnProfileProducer.js:190:13` ConditionalExpression Survived in buildTurnProfileWindowForGroups — pre-existing (BL-1364 equivalents): BL-1488 hardener in-pass (under-50 default)
- `out/metrics/turnProfileProducer.js:190:48` BlockStatement Survived in buildTurnProfileWindowForGroups — pre-existing (BL-1364 equivalents): BL-1488 hardener in-pass (under-50 default)
- `out/metrics/turnProfileProducer.js:201:36` StringLiteral Survived in windowDedupeKey — pre-existing (BL-1364 equivalents): BL-1488 hardener in-pass (under-50 default)
- `out/metrics/turnProfileProducer.js:232:116` StringLiteral Survived in upsertWindowRecord — pre-existing (BL-1364 equivalents): BL-1488 hardener in-pass (under-50 default)
- `out/metrics/turnProfileProducer.js:278:9` ConditionalExpression Survived in resolveEntrySummary — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:278:16` BlockStatement NoCoverage in resolveEntrySummary — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:282:16` ObjectLiteral NoCoverage in resolveEntrySummary — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:282:24` StringLiteral NoCoverage in resolveEntrySummary — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:285:24` StringLiteral Survived in resolveEntrySummary — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:287:9` LogicalOperator Survived in resolveEntrySummary — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:287:9` ConditionalExpression Survived in resolveEntrySummary — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:287:44` ConditionalExpression Survived in resolveEntrySummary — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:287:44` EqualityOperator Survived in resolveEntrySummary — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:290:20` StringLiteral Survived in resolveEntrySummary — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:307:9` ConditionalExpression Survived in accumulateEntrySummary — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:307:32` BlockStatement NoCoverage in accumulateEntrySummary — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:320:72` BooleanLiteral Survived in runTick — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:322:13` ConditionalExpression Survived in runTick — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:322:30` StringLiteral Survived in runTick — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:322:38` BlockStatement NoCoverage in runTick — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:355:26` ConditionalExpression Survived in resolveProducerTickOptions — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:355:60` ArithmeticOperator Survived in resolveProducerTickOptions — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:359:47` ArrayDeclaration Survived in partialProducerResult — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:359:61` BooleanLiteral Survived in partialProducerResult — BL-1476's own lines: BL-1488 hardener in-pass (rule item 2)
- `out/metrics/turnProfileProducer.js:383:9` LogicalOperator Survived in runTurnProfileProducer — pre-existing (BL-1364 equivalents): BL-1488 hardener in-pass (under-50 default)
- `out/tools/run-turn-profile-producer.js:49:17` BlockStatement NoCoverage in main — thin CLI main() body: BL-1488 hardener in-pass (kill via in-process seam or re-accept)
- `out/tools/run-turn-profile-producer.js:51:70` ObjectLiteral NoCoverage in main — thin CLI main() body: BL-1488 hardener in-pass (kill via in-process seam or re-accept)

## Census script

```
node census-json.js <coder-worktree>/extension/reports/mutation/mutation.json <coder-worktree>/extension/ --rows
```
```js
const fs=require('fs');
const R=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); const WT=process.argv[3]; const showRows=process.argv[4]==='--rows';
const srcCache={};
function enclosing(file,line){ if(!srcCache[file]) srcCache[file]=fs.readFileSync(WT+file,'utf8').split('\n'); const S=srcCache[file]; for(let i=line-1;i>=0;i--){const t=S[i]; let m=/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)/.exec(t)||/^(?:exports\.|const |let |var )([A-Za-z0-9_$]+)\s*=/.exec(t)||/^class\s+([A-Za-z0-9_$]+)/.exec(t); if(m) return m[1];} return '<module-top>'; }
const rows=[];
for(const [file,f] of Object.entries(R.files)){ const b={surv:{},nocov:{},t:{surv:0,nocov:0,total:f.mutants.length}}; for(const m of f.mutants){ if(m.status!=='Survived'&&m.status!=='NoCoverage') continue; const mode=m.status==='Survived'?'surv':'nocov'; const line=m.location.start.line; const fn=enclosing(file,line); b[mode][fn]=(b[mode][fn]||0)+1; b.t[mode]++; rows.push({file,line,col:m.location.start.column,mut:m.mutatorName,mode,fn}); }
 console.log(`\n### ${file}  mutants=${b.t.total} surv=${b.t.surv} nocov=${b.t.nocov}`); const fns={}; for(const k of Object.keys(b.surv)) fns[k]=(fns[k]||0)+b.surv[k]; for(const k of Object.keys(b.nocov)) fns[k]=(fns[k]||0)+b.nocov[k]; const r=Object.entries(fns).sort((a,b)=>b[1]-a[1]); console.log(`  functions=${r.length}`); for(const [fn,n] of r) console.log(`  ${String(n).padStart(4)}  ${fn}  (s${b.surv[fn]||0}/n${b.nocov[fn]||0})`); }
if(showRows){ console.log('\n### ROWS'); rows.sort((a,b)=>a.file.localeCompare(b.file)||a.line-b.line||a.col-b.col); for(const r of rows) console.log(`- \`${r.file}:${r.line}:${r.col}\` ${r.mut} ${r.mode==='surv'?'Survived':'NoCoverage'} in ${r.fn}`); }
```
The `git blame` per function used the same top-level `function` ranges on
the TypeScript source (`git blame -l -- <file>`, counted by commit prefix).
