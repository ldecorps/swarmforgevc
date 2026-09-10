# BL-1441 — mutation gate discharge — BL-956-pipeline-board-caption-and-cap-hotfix

Gate: `mutation`. File set: `extension/src/concierge/pipelineBoard.ts`
(deferred 2026-08-19, blocked first by BL-1425's 2026-09-05 cooldown reset,
then by BL-1451's 2026-09-07 22:47 re-touch — see
`backlog/evidence/BL-1441-coder-pass-20260908.md`). This row's own
`gherkin-mutation` gate discharged separately on 2026-09-05
(`backlog/evidence/BL-1439-bl956-gherkin-mutation.md`) — only the
`mutation` gate is outstanding here.

## Eligibility, checked fresh before the run (2026-09-10)

`mutation_cooldown_gate.bb`: **run**, `file_age_days 2.91` (cooldown 1
day). Host load at check time: `1.81/20` — quiet.

## The run

`node scripts/ensureStrykerSandboxSiblings.js` re-verified, then
`npx stryker run stryker.bl1441bl956.config.json` (concurrency 1, `perTest`,
`vitest.bl1441bl956.stryker.config.mjs` scoping the dry run to the 5 test
files that import `pipelineBoard` by exact path — never the
`pipelineBoardSync`/`pipelineBoardPinSync` siblings a bare substring grep
would also catch).

Mutation phase: **3 minutes 17 seconds**, 1028 mutants instrumented.

```
Ran 10.57 tests per mutant on average.
                  | % Mutation score |          |           |            |          |          |
File              |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
All files         |  78.99 |   82.10 |      811 |         1 |        177 |       39 |        0 |
 pipelineBoard.js |  78.99 |   82.10 |      811 |         1 |        177 |       39 |        0 |
```

0 errors — completed run.

## Every survivor and every no-coverage gap, named

Same method as `BL-1441-BL-620-mutation.md` and `BL-1441-BL-955-mutation.md`:
generated directly from `reports/mutation/mutation.json` (gitignored; this
table is the durable record), not hand-transcribed.

**Not force-discharged, not force-killed.** No mutant suppressed, no
assertion loosened, no test authored here — closing this gap is the
hardener's domain (Article 1.6), downstream in this ticket's own
`required_stages`.

Survivors: 177

## Survived mutants (177), one line each

#### out/concierge/pipelineBoard.js — Survived (177)

- `out/concierge/pipelineBoard.js:76:9` ConditionalExpression -> `false` — ran against 42 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:78:12` OptionalChaining -> `meta.swarm` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:173:12` MethodExpression -> `title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)` — ran against 49 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:173:12` MethodExpression -> `title.toLowerCase().replace(/[^a-z0-9]+/g, ' ')` — ran against 49 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:175:18` Regex -> `/[^a-z0-9]/g` — ran against 49 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:177:16` Regex -> `/\s/` — ran against 49 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:203:34` Regex -> `/(?:BL|GH)-(\d+)$/` — ran against whole suite, 216 tests, none caught it
- `out/concierge/pipelineBoard.js:203:34` Regex -> `/^(?:BL|GH)-(\d+)/` — ran against whole suite, 216 tests, none caught it
- `out/concierge/pipelineBoard.js:238:16` ConditionalExpression -> `true` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:246:10` OptionalChaining -> `meta.filename` — ran against 13 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:371:24` ConditionalExpression -> `true` — ran against 42 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:371:24` LogicalOperator -> `swarm !== undefined || localSwarmName !== undefined` — ran against 42 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:371:24` ConditionalExpression -> `true` — ran against 42 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:371:47` ConditionalExpression -> `true` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:383:53` ConditionalExpression -> `false` — ran against 41 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:383:65` StringLiteral -> `""` — ran against 41 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:395:17` ConditionalExpression -> `false` — ran against 42 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:395:58` ObjectLiteral -> `{}` — ran against 1 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:403:9` ConditionalExpression -> `true` — ran against 11 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:403:9` ConditionalExpression -> `false` — ran against 11 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:403:9` EqualityOperator -> `pa === pb` — ran against 11 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:403:20` BlockStatement -> `{}` — ran against 11 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:413:22` MethodExpression -> `workflowPaused.filter(item => item.humanApproval === 'pending')` — ran against 87 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:425:13` ConditionalExpression -> `false` — ran against 1 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:431:18` ConditionalExpression -> `true` — ran against 1 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:443:22` MethodExpression -> `paused.filter(item => isEpicTrackerPausedItem(item) && item.humanApproval !== 'pending')` — ran against 87 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:447:26` LogicalOperator -> `item.epic && ticketMeta[item.id]?.epic` — ran against 7 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:511:13` ConditionalExpression -> `true` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:522:13` ConditionalExpression -> `true` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:545:39` ArrayDeclaration -> `["Stryker was here"]` — ran against 13 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:596:20` MethodExpression -> `allParked` — ran against 87 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:627:12` ConditionalExpression -> `false` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:627:12` EqualityOperator -> `text.length > width` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:670:29` ObjectLiteral -> `{}` — ran against whole suite, 216 tests, none caught it
- `out/concierge/pipelineBoard.js:671:12` StringLiteral -> `""` — ran against whole suite, 216 tests, none caught it
- `out/concierge/pipelineBoard.js:672:13` StringLiteral -> `""` — ran against whole suite, 216 tests, none caught it
- `out/concierge/pipelineBoard.js:673:10` StringLiteral -> `""` — ran against whole suite, 216 tests, none caught it
- `out/concierge/pipelineBoard.js:676:9` EqualityOperator -> `text.length < exports.PIPELINE_BOARD_CAPTION_DESCRIPTION_MAX` — ran against 120 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:683:25` MethodExpression -> `row.title ?? ''` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:683:53` MethodExpression -> `row.slug` — ran against 55 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:704:19` ConditionalExpression -> `true` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:704:19` ConditionalExpression -> `false` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:704:19` LogicalOperator -> `dot !== undefined || Object.prototype.hasOwnProperty.call(exports.HEALTH_DOT_GLYPHS, dot)` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:704:19` ConditionalExpression -> `true` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:704:19` EqualityOperator -> `dot === undefined` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:712:27` MethodExpression -> `visibleRows.map(r => r.swarm)` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:712:73` ConditionalExpression -> `true` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:753:19` ArrayDeclaration -> `["Stryker was here"]` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:755:19` BooleanLiteral -> `true` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:758:17` ConditionalExpression -> `true` — ran against 13 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:758:17` ConditionalExpression -> `false` — ran against 13 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:758:26` BlockStatement -> `{}` — ran against 5 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:759:28` StringLiteral -> `"Stryker was here!"` — ran against 5 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:785:54` MethodExpression -> `displayIds` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:791:9` ConditionalExpression -> `true` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:791:9` ConditionalExpression -> `false` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:791:9` EqualityOperator -> `captions[0] === ''` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:791:25` StringLiteral -> `"Stryker was here!"` — ran against 72 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:791:29` BlockStatement -> `{}` — ran against 13 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:792:20` StringLiteral -> `"Stryker was here!"` — ran against 13 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:848:13` ConditionalExpression -> `true` — ran against 87 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:848:13` EqualityOperator -> `omitted >= 0` — ran against 87 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:895:25` MethodExpression -> `parked` — ran against 86 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:895:46` ConditionalExpression -> `true` — ran against 7 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:899:20` StringLiteral -> `"Stryker was here!"` — ran against 9 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:907:20` MethodExpression -> ``  ${deriveDisplayTicketId(entry.id)} ${entry.slug}`.trimStart()` — ran against 7 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:909:9` ConditionalExpression -> `true` — ran against 9 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:925:34` ConditionalExpression -> `true` — ran against 85 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:928:20` StringLiteral -> `"Stryker was here!"` — ran against 9 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:932:9` ConditionalExpression -> `true` — ran against 9 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:932:9` ConditionalExpression -> `false` — ran against 9 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:969:9` ConditionalExpression -> `false` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:969:37` BlockStatement -> `{}` — ran against 5 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:972:26` StringLiteral -> `"Stryker was here!"` — ran against 1 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:972:72` StringLiteral -> `""` — ran against 1 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:995:28` OptionalChaining -> `parts.find(p => p.type === type).value` — ran against 40 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1023:25` LogicalOperator -> `data.parked && []` — ran against 11 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1023:44` BlockStatement -> `{}` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1026:44` ArrayDeclaration -> `["Stryker was here"]` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1029:48` ArrayDeclaration -> `["Stryker was here"]` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1029:52` BlockStatement -> `{}` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1037:9` ConditionalExpression -> `false` — ran against 9 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1037:9` LogicalOperator -> `!path && !repoBaseUrl` — ran against 9 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1037:32` BlockStatement -> `{}` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1044:29` StringLiteral -> ```` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1044:54` StringLiteral -> `"Stryker was here!"` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1045:65` StringLiteral -> `"Stryker was here!"` — ran against 8 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1046:12` MethodExpression -> ``  ${idHtml}${slugPart}${agePart}`.trimStart()` — ran against 9 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1051:19` ArrayDeclaration -> `["Stryker was here"]` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1052:9` ConditionalExpression -> `true` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1052:9` ConditionalExpression -> `false` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1052:9` EqualityOperator -> `entry.activeChildCount >= 0` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1052:9` EqualityOperator -> `entry.activeChildCount <= 0` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1055:9` ConditionalExpression -> `true` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1055:9` ConditionalExpression -> `false` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1055:9` EqualityOperator -> `entry.pausedChildCount >= 0` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1055:9` EqualityOperator -> `entry.pausedChildCount <= 0` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1058:20` ConditionalExpression -> `true` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1058:20` ConditionalExpression -> `false` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1058:20` EqualityOperator -> `parts.length >= 0` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1058:20` EqualityOperator -> `parts.length <= 0` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1058:66` StringLiteral -> `"Stryker was here!"` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1068:25` MethodExpression -> `parked` — ran against 32 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1068:39` ArrowFunction -> `() => undefined` — ran against 32 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1068:46` ConditionalExpression -> `true` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1068:46` ConditionalExpression -> `false` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1068:46` EqualityOperator -> `p.status !== 'parked'` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1068:59` StringLiteral -> `""` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1069:9` ConditionalExpression -> `false` — ran against 32 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1069:93` BlockStatement -> `{}` — ran against 25 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1070:16` ArrayDeclaration -> `["Stryker was here"]` — ran against 25 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1072:20` StringLiteral -> `"Stryker was here!"` — ran against 7 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1074:22` ConditionalExpression -> `false` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1080:38` BlockStatement -> `{}` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1081:22` ConditionalExpression -> `true` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1081:22` ConditionalExpression -> `false` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1090:9` ConditionalExpression -> `false` — ran against 32 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1090:34` ConditionalExpression -> `true` — ran against 32 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1090:34` LogicalOperator -> `overflowLine === undefined && overflowLine === ''` — ran against 32 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1090:34` ConditionalExpression -> `false` — ran against 32 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1090:34` EqualityOperator -> `overflowLine !== undefined` — ran against 32 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1090:86` BlockStatement -> `{}` — ran against 32 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1091:16` ArrayDeclaration -> `["Stryker was here"]` — ran against 32 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1093:19` ArrayDeclaration -> `[]` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1093:20` StringLiteral -> `"Stryker was here!"` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1095:22` ConditionalExpression -> `false` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1098:9` ConditionalExpression -> `false` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1104:9` ConditionalExpression -> `false` — ran against 32 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1104:23` BlockStatement -> `{}` — ran against 21 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1105:16` ArrayDeclaration -> `["Stryker was here"]` — ran against 21 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1108:19` ArrayDeclaration -> `["Stryker was here"]` — ran against 11 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1110:13` ConditionalExpression -> `false` — ran against 7 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1113:13` ConditionalExpression -> `false` — ran against 7 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1113:40` BooleanLiteral -> `linkedIds.has(row.id)` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1113:64` BlockStatement -> `{}` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1117:13` ConditionalExpression -> `false` — ran against 7 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1122:12` ConditionalExpression -> `false` — ran against 11 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1122:33` ArrayDeclaration -> `["Stryker was here"]` — ran against 4 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1122:39` StringLiteral -> `"Stryker was here!"` — ran against 7 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1125:54` ArrayDeclaration -> `["Stryker was here"]` — ran against 20 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1126:56` StringLiteral -> `""` — ran against 32 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1137:68` MethodExpression -> `parked` — ran against 32 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1137:89` ConditionalExpression -> `true` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1140:9` StringLiteral -> `"Stryker was here!"` — ran against 32 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1143:36` StringLiteral -> `""` — ran against 32 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1153:9` EqualityOperator -> `full.length < maxLength` — ran against 32 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1153:53` ConditionalExpression -> `false` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1156:20` MethodExpression -> `[...(data.links ?? [])]` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1156:20` ArrayDeclaration -> `[]` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1156:25` LogicalOperator -> `data.links && []` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1157:21` ArithmeticOperator -> `sorted.length + 1` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1157:40` ConditionalExpression -> `false` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1157:40` EqualityOperator -> `keep > 0` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1157:40` EqualityOperator -> `keep < 0` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1157:62` BlockStatement -> `{}` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1158:35` MethodExpression -> `sorted` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1158:61` ArrowFunction -> `() => undefined` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1160:13` ConditionalExpression -> `false` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1160:13` EqualityOperator -> `candidate.length < maxLength` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1160:44` BlockStatement -> `{}` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1161:57` ArithmeticOperator -> `sorted.length + keep` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1206:31` BlockStatement -> `{}` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1208:34` ArithmeticOperator -> `links.length + (includedLines.length + 1)` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1208:50` ArithmeticOperator -> `includedLines.length - 1` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1210:13` ConditionalExpression -> `true` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1210:13` EqualityOperator -> `candidateOmitted >= 0` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1213:13` ConditionalExpression -> `true` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1213:13` EqualityOperator -> `candidateLines.join('\n').length >= maxLinksLength` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1213:13` EqualityOperator -> `candidateLines.join('\n').length <= maxLinksLength` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1221:9` ConditionalExpression -> `false` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1221:9` LogicalOperator -> `links.length === 0 && !repoBaseUrl` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1221:9` ConditionalExpression -> `false` — ran against 6 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1221:45` BlockStatement -> `{}` — ran against 2 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1225:9` EqualityOperator -> `full.length < maxLinksLength` — ran against 4 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1237:9` EqualityOperator -> `lines.join('\n').length >= maxLinksLength` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1237:20` StringLiteral -> `""` — ran against 3 covering test(s), none caught it
- `out/concierge/pipelineBoard.js:1245:31` StringLiteral -> `""` — ran against 2 covering test(s), none caught it

## No-coverage mutants (39), one line each — real coverage gaps, not "survivors" in Stryker's own sense but reported for completeness

#### out/concierge/pipelineBoard.js — NoCoverage (39)

- `out/concierge/pipelineBoard.js:317:32` ArrayDeclaration -> `["Stryker was here"]` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:447:39` OptionalChaining -> `ticketMeta[item.id].epic` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:447:68` StringLiteral -> `"Stryker was here!"` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:535:41` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:537:13` ConditionalExpression -> `true` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:537:13` ConditionalExpression -> `false` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:537:19` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:538:24` ObjectLiteral -> `{}` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:649:39` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:705:31` StringLiteral -> ```` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:925:64` ConditionalExpression -> `false` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:925:64` EqualityOperator -> `overflowLine !== ''` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:925:81` StringLiteral -> `"Stryker was here!"` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:932:23` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:933:20` StringLiteral -> ```` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:949:35` ArrayDeclaration -> `["Stryker was here"]` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:995:73` StringLiteral -> `"Stryker was here!"` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1023:40` ArrayDeclaration -> `["Stryker was here"]` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1026:48` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1052:37` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1053:20` StringLiteral -> ```` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1055:37` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1056:20` StringLiteral -> ```` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1058:39` StringLiteral -> ```` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1058:55` StringLiteral -> `""` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1074:49` BooleanLiteral -> `linkedIds.has(epic.trackerId)` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1081:49` BooleanLiteral -> `linkedIds.has(entry.id)` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1090:64` ConditionalExpression -> `false` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1090:64` EqualityOperator -> `overflowLine !== ''` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1090:81` StringLiteral -> `"Stryker was here!"` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1095:49` BooleanLiteral -> `linkedIds.has(entry.id)` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1098:23` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1099:20` StringLiteral -> ```` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1110:34` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1117:20` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1128:35` ArrayDeclaration -> `["Stryker was here"]` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1153:68` ArrayDeclaration -> `["Stryker was here"]` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1156:39` ArrayDeclaration -> `["Stryker was here"]` — no test in this row's include set executes this code
- `out/concierge/pipelineBoard.js:1164:12` ObjectLiteral -> `{}` — no test in this row's include set executes this code

## Verification

| check | result |
|---|---|
| `mutation_cooldown_gate.bb` | `run` (2.91 days) |
| host load, pre-launch | `2.46/20` (quiet) |
| `node scripts/ensureStrykerSandboxSiblings.js` | all 6 siblings verified, none newly created |
| `npx stryker run stryker.bl1441bl956.config.json` | 1028 mutants, 811 killed, 177 survived, 39 no coverage, 1 timeout, 0 errors — completed run, 3m17s |
| `bb hardening_debt_ledger_read.bb .` (before discharge) | BL-956-pipeline-board-caption-and-cap-hotfix `mutation` row: `attempted_at: 2026-09-08`, `discharged_at: null` |

## Scope

Nothing in `out_of_scope` touched. No mutant suppressed, no test authored
to chase survivors — hardener's next-stage work against this evidence.
