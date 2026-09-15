# BL-1509 — survivor census over telegramClient.ts's first mutation run, specifier, 2026-09-15

Specifier record, made while completing the hardender's `unowned-survivors`
note of 2026-09-15T13:54Z (`unowned-survivors BL-1509 telegramClient.ts
107/19 BL-1509-hardender-20260915`, inbound
`00_20260915T135444Z_001332_from_hardender_to_specifier`). The hardender's
own run is described in `backlog/evidence/BL-1509-hardender-20260915.md`
on its tip `25a44feb63`; it kept clear-text reporters only and no
incremental file, so it names the counts but not the mutants. This file is
the partition basis for the owner ticket minted with it (BL-1577) and for
the ruling BL-1577 asks.

## Reproduction (exact commands)

The run was repeated unchanged, with a `json` reporter added, in the
hardender's compiled worktree (`out/notify/telegramClient.js` compiled
14:49 at `25a44feb63`; source identical to `main`'s `sendDocument`-bearing
tip). Concurrency 2, so as not to starve QA's concurrent suite:

```
cd .worktrees/hardender/extension
node scripts/ensureStrykerSandboxSiblings.js   # without it the sandbox cannot resolve ../specs and the dry run dies loading vitest.config.mjs
npx stryker run <config>
# <config> = stryker.config.json with: vitest.configFile vitest.bl1509.stryker.config.mjs,
#   concurrency 2, dryRunTimeoutMinutes 15, incremental false, coverageAnalysis perTest,
#   reporters [clear-text, progress, json], mutate [out/notify/telegramClient.js]
# 15:18:15 -> 15:27:42 BST (9 min 24 s of mutation testing), load 3.4-7.3 / 20 cores,
# 8.59 tests per mutant on average. Result identical to the hardender's counts:
#   telegramClient.js | 80.70 | 83.12 | 520 killed | 7 timeout | 107 survived | 19 no-cov | 3 ignored
#   656 instrumented (the 3 ignored are line 2's entrypoint-boilerplate literals, BL-447/BL-498)
```

Census: each Survived / NoCoverage / Timeout mutant in the JSON report
attributed to the enclosing top-level declaration of the compiled file at
the line Stryker reported (same method as
`BL-1519-first-run-survivor-census-20260910.md`; script at the end).

## Caveats

- The dry-run include set is `vitest.bl1509.stryker.config.mjs`: the full
  unit suite minus the two known Stryker-sandbox-broken files
  (`activePoolFreshnessAudit.test.js`,
  `bl1418RoleEnumerationClassification.test.js`, standing rule 2026-09-05).
  Neither reaches telegramClient, so `NoCoverage` here is a statement
  about the whole suite, not a scoped include set. Cross-check from the
  hardender's fresh `vitest run --coverage` report (14:51): 736/742
  statements and 204/226 branches of the file are covered; the only
  wholly unreached function is `defaultWaitMs`; `defaultPost` has two
  unreached statements and `extractPollId` one unreached branch. The 19
  no-coverage mutants sit on those and on the 22 unreached branches.
- Timeouts count as killed in Stryker's score. The 7 sit in the
  rate-limit retry helpers (`retryOnRateLimit` 3,
  `createForumTopicWithRateLimitRetry` 3,
  `sendTelegramMessageWithRateLimitRetry` 1): a mutant that removes the
  retry bound loops until the per-mutant timeout. Listed so a reader does
  not mistake them for survivors.
- No survivor sits on a module-level declaration; all 126 are inside
  function bodies.

## Totals

| Status | Count |
|---|---|
| Killed | 520 |
| Timeout | 7 |
| Survived | 107 |
| NoCoverage | 19 |
| Ignored | 3 |
| Instrumented | 656 |

## Per-function census (survived s / no-coverage n / timeout t), 35 functions

```
  10 extractIconStickers                        s7/n3/t0
   8 extractForumTopicCreatedName               s7/n1/t0
   8 setChatMenuButton                          s5/n3/t0
   8 extractResultObject                        s8/n0/t0
   7 bl568PlanMenuAnswerDrive                   s3/n4/t0
   7 extractPollId                              s7/n0/t0
   7 extractFilePath                            s7/n0/t0
   6 extractParameters                          s6/n0/t0
   6 extractDescription                         s6/n0/t0
   5 inlineKeyboardButtonToWire                 s4/n1/t0
   5 getBotUsername                             s5/n0/t0
   4 defaultPost                                s3/n1/t0
   4 extractUpdates                             s3/n1/t0
   4 defaultPostVoice                           s3/n1/t0
   4 resolveForumTopicName                      s4/n0/t0
   4 extractPinnedMessageId                     s4/n0/t0
   4 sendTelegramMessageWithRateLimitRetry      s4/n0/t1
   3 sendTelegramMessage                        s3/n0/t0
   3 sendVoiceNote                              s3/n0/t0
   2 defaultWaitMs                              s0/n2/t0
   2 bl568MenuAnswerPollMapping                 s2/n0/t0
   2 bl568FingerprintMatches                    s2/n0/t0
   2 editForumTopic                             s2/n0/t0
   2 downloadTelegramFile                       s2/n0/t0
   1 formatNetworkError                         s0/n1/t0
   1 bl568TextFallbackMessage                   s0/n1/t0
   1 callTelegramApi                            s1/n0/t0
   1 extractResultNumberField                   s1/n0/t0
   1 sendTelegramPoll                           s1/n0/t0
   1 editMessageText                            s1/n0/t0
   1 answerCallbackQuery                        s1/n0/t0
   1 createForumTopic                           s1/n0/t0
   1 getFile                                    s1/n0/t0
   0 retryOnRateLimit                           s0/n0/t3
   0 createForumTopicWithRateLimitRetry         s0/n0/t3
```

Reading: 56 of the 107 survivors sit in the ten `extract*` response-shape
readers (`extractResultObject` 8, `extractIconStickers` 7,
`extractForumTopicCreatedName` 7, `extractPollId` 7, `extractFilePath` 7,
`extractParameters` 6, `extractDescription` 6, `extractPinnedMessageId` 4,
`extractUpdates` 3, `extractResultNumberField` 1): defensive type guards
on malformed Bot API responses that no test feeds. The 19 no-coverage
mutants are `bl568PlanMenuAnswerDrive` 4, `extractIconStickers` 3,
`setChatMenuButton` 3, `defaultWaitMs` 2, and one each in
`extractForumTopicCreatedName`, `inlineKeyboardButtonToWire`,
`defaultPost`, `extractUpdates`, `defaultPostVoice`, `formatNetworkError`
and `bl568TextFallbackMessage`.

## Per-mutant lines (compiled `out/notify/telegramClient.js` line:column, mutator, S/N/T)

### extractIconStickers
  552:33 BlockStatement N
  553:16 ArrayDeclaration N
  557:59 StringLiteral N
  551:20 LogicalOperator S
  551:20 ConditionalExpression S
  551:28 ConditionalExpression S
  552:9 ConditionalExpression S
  556:16 ConditionalExpression S
  557:31 OptionalChaining S
  556:23 OptionalChaining S

### extractForumTopicCreatedName
  212:50 BlockStatement N
  207:19 OptionalChaining S
  208:9 LogicalOperator S
  208:19 ConditionalExpression S
  212:9 ConditionalExpression S
  212:9 LogicalOperator S
  212:21 ConditionalExpression S
  216:12 ConditionalExpression S

### setChatMenuButton
  303:36 ObjectLiteral N
  305:15 ObjectLiteral N
  305:23 StringLiteral N
  303:13 ConditionalExpression S
  303:13 ConditionalExpression S
  303:13 EqualityOperator S
  304:22 ConditionalExpression S
  304:42 StringLiteral S

### extractResultObject
  134:9 ConditionalExpression S
  134:9 LogicalOperator S
  134:9 ConditionalExpression S
  134:9 LogicalOperator S
  134:9 ConditionalExpression S
  134:9 LogicalOperator S
  135:9 ConditionalExpression S
  137:9 ConditionalExpression S

### bl568PlanMenuAnswerDrive
  258:33 BlockStatement N
  259:16 ObjectLiteral N
  259:26 StringLiteral N
  259:42 StringLiteral N
  258:9 ConditionalExpression S
  261:18 MethodExpression S
  262:47 ArrayDeclaration S

### extractPollId
  219:18 OptionalChaining S
  220:9 ConditionalExpression S
  220:9 LogicalOperator S
  220:9 ConditionalExpression S
  220:9 LogicalOperator S
  220:17 ConditionalExpression S
  220:45 ConditionalExpression S

### extractFilePath
  568:20 ConditionalExpression S
  568:20 LogicalOperator S
  568:28 ConditionalExpression S
  569:22 ConditionalExpression S
  569:22 LogicalOperator S
  569:32 ConditionalExpression S
  570:12 ConditionalExpression S

### extractParameters
  62:9 LogicalOperator S
  62:9 ConditionalExpression S
  62:9 ConditionalExpression S
  62:9 LogicalOperator S
  62:17 ConditionalExpression S
  62:45 ConditionalExpression S

### extractDescription
  125:9 ConditionalExpression S
  125:9 LogicalOperator S
  125:9 LogicalOperator S
  125:9 ConditionalExpression S
  125:17 ConditionalExpression S
  125:45 ConditionalExpression S

### inlineKeyboardButtonToWire
  119:71 StringLiteral N
  113:27 BlockStatement S
  113:9 ConditionalExpression S
  114:16 ObjectLiteral S
  114:46 ObjectLiteral S

### getBotUsername
  315:58 StringLiteral S
  316:9 ConditionalExpression S
  316:26 BlockStatement S
  319:22 OptionalChaining S
  320:12 ConditionalExpression S

### defaultPost
  46:11 BlockStatement N
  35:17 StringLiteral S
  36:18 ObjectLiteral S
  36:36 StringLiteral S

### extractUpdates
  358:45 ArrayDeclaration N
  357:20 ConditionalExpression S
  357:20 LogicalOperator S
  357:28 ConditionalExpression S

### defaultPostVoice
  610:11 BlockStatement N
  605:34 ObjectLiteral S
  605:44 StringLiteral S
  607:9 BlockStatement S

### resolveForumTopicName
  190:15 StringLiteral S
  195:26 BlockStatement S
  195:9 ConditionalExpression S
  200:9 ConditionalExpression S

### extractPinnedMessageId
  342:27 OptionalChaining S
  343:9 LogicalOperator S
  343:26 ConditionalExpression S
  343:63 ConditionalExpression S

### sendTelegramMessageWithRateLimitRetry
  490:16 ObjectLiteral S
  490:27 BooleanLiteral S
  490:41 StringLiteral S
  491:50 UpdateOperator T
  491:27 EqualityOperator S

### sendTelegramMessage
  171:13 ConditionalExpression S
  172:13 ConditionalExpression S
  174:13 ConditionalExpression S

### sendVoiceNote
  627:35 ArrayDeclaration S
  627:45 StringLiteral S
  636:60 StringLiteral S

### defaultWaitMs
  532:28 BlockStatement N
  533:24 ArrowFunction N

### bl568MenuAnswerPollMapping
  245:18 ArrayDeclaration S
  248:68 ArrayDeclaration S

### bl568FingerprintMatches
  252:12 ConditionalExpression S
  252:12 EqualityOperator S

### editForumTopic
  524:13 ConditionalExpression S
  523:13 ConditionalExpression S

### downloadTelegramFile
  596:57 StringLiteral S
  601:60 StringLiteral S

### formatNetworkError
  87:57 StringLiteral N

### bl568TextFallbackMessage
  265:44 StringLiteral N

### callTelegramApi
  109:60 StringLiteral S

### extractResultNumberField
  144:12 ConditionalExpression S

### sendTelegramPoll
  230:13 ConditionalExpression S

### editMessageText
  282:13 ConditionalExpression S

### answerCallbackQuery
  390:75 ConditionalExpression S

### createForumTopic
  413:13 ConditionalExpression S

### getFile
  582:78 StringLiteral S

### retryOnRateLimit
  443:14 BlockStatement T
  448:13 ConditionalExpression T
  448:53 BlockStatement T

### createForumTopicWithRateLimitRetry
  469:14 BlockStatement T
  471:13 ConditionalExpression T
  471:71 BlockStatement T

## How it was counted (re-run this, do not re-derive)

```
node census1509.js <mutation.json> <compiled telegramClient.js> [--lines]
```

```js
// Census of a Stryker JSON report: each Survived / NoCoverage / Timeout mutant
// attributed to the enclosing top-level declaration of the compiled file.
const fs=require('fs');
const [,, reportPath, compiledFile] = process.argv;
const rep=JSON.parse(fs.readFileSync(reportPath,'utf8'));
const key=Object.keys(rep.files).find(k=>k.endsWith('out/notify/telegramClient.js')||k.endsWith('telegramClient.js'));
const L=fs.readFileSync(compiledFile,'utf8').split('\n');
function enclosing(line){ for(let i=line-1;i>=0;i--){ const t=L[i];
  let m=/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)/.exec(t)||/^(?:exports\.|const |let |var )([A-Za-z0-9_$]+)\s*=/.exec(t)||/^class\s+([A-Za-z0-9_$]+)/.exec(t);
  if(m) return m[1]; } return '<module-top>'; }
const ms=rep.files[key].mutants; const tot={};
const by={};
for(const m of ms){ tot[m.status]=(tot[m.status]||0)+1; if(!['Survived','NoCoverage','Timeout'].includes(m.status)) continue;
  const fn=enclosing(m.location.start.line); by[fn]=by[fn]||{Survived:0,NoCoverage:0,Timeout:0,lines:[]}; by[fn][m.status]++; by[fn].lines.push(`${m.location.start.line}:${m.location.start.column} ${m.mutatorName} ${m.status[0]}`); }
console.log('file',key); console.log('totals',JSON.stringify(tot));
const rows=Object.entries(by).sort((a,b)=>(b[1].Survived+b[1].NoCoverage)-(a[1].Survived+a[1].NoCoverage));
console.log('functions with survivors/no-cov/timeouts:',rows.length);
for(const [fn,b] of rows) console.log(String(b.Survived+b.NoCoverage).padStart(4), fn.padEnd(42), `s${b.Survived}/n${b.NoCoverage}/t${b.Timeout}`);
if(process.argv[4]==='--lines') for(const [fn,b] of rows){ console.log('\n## '+fn); for(const l of b.lines) console.log('  '+l); }
```
