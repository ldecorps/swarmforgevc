# BL-1441 — mutation gate discharge — BL-955

Gate: `mutation`. File set: `extension/src/onboarding/negotiationTelegramRelay.ts`,
`extension/src/onboarding/negotiationTelegramRouting.ts`,
`extension/src/tools/telegramFrontDeskBotCore.ts` (shares
`telegramFrontDeskBotCore.ts` with BL-620's row above — a separate run
against this row's own, narrower test-include set; deferred 2026-08-19,
blocked first by BL-1425's 2026-09-05 cooldown reset on the shared file,
then by BL-1475's 2026-09-08 01:55 re-touch — see
`backlog/evidence/BL-1441-coder-pass-20260908.md`).

## Eligibility, checked fresh before the run (2026-09-10)

| file | `mutation_cooldown_gate.bb` decision | file_age_days |
|---|---|---|
| negotiationTelegramRelay.ts | run | 22.16 |
| negotiationTelegramRouting.ts | run | 22.16 |
| telegramFrontDeskBotCore.ts | run | 2.78 |

Host load at check time: `1.58/20` — quiet (BL-620's discharge had just
landed moments before).

## The run

`node scripts/ensureStrykerSandboxSiblings.js` re-verified (no new links —
`npm run compile` output from the BL-620 pass is still current, no source
touched since), then
`npx stryker run stryker.bl1441bl955.config.json` (concurrency 1, `perTest`,
`vitest.bl1441bl955.stryker.config.mjs` scoping the dry run to the 9 test
files that import these three modules by path).

Mutation phase: **9 minutes 47 seconds**, 2195 mutants instrumented.

```
Ran 38.00 tests per mutant on average.
                                | % Mutation score |          |           |            |          |          |
File                            |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
All files                       |  82.05 |   85.60 |     1795 |         6 |        303 |       91 |        0 |
 onboarding                     |  89.80 |   89.80 |      132 |         0 |         15 |        0 |        0 |
  negotiationTelegramRelay.js   |  93.44 |   93.44 |       57 |         0 |          4 |        0 |        0 |
  negotiationTelegramRouting.js |  87.21 |   87.21 |       75 |         0 |         11 |        0 |        0 |
 tools                          |  81.49 |   85.28 |     1663 |         6 |        288 |       91 |        0 |
  telegramFrontDeskBotCore.js   |  81.49 |   85.28 |     1663 |         6 |        288 |       91 |        0 |
```

0 errors — completed run. `telegramFrontDeskBotCore.js`'s numbers differ
from BL-620's row (83.40%/86.70%, 262 survived, 78 no-coverage there) because
each row runs the file's mutants against its own, differently-scoped test
include set — both are real, independent runs, not a duplicate or a
contradiction.

## Every survivor and every no-coverage gap, named

Same method as `BL-1441-BL-620-mutation.md`: generated directly from
`reports/mutation/mutation.json` (gitignored; this table is the durable
record), not hand-transcribed.

**Not force-discharged, not force-killed.** No mutant suppressed, no
assertion loosened, no test authored here — closing this gap is the
hardener's domain (Article 1.6), downstream in this ticket's own
`required_stages`.

Survivors: 303

## Survived mutants (303), one line each
- `out/tools/telegramFrontDeskBotCore.js:70:66` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:71:65` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:72:62` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:73:59` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:74:63` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:75:69` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:76:65` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:77:65` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:78:67` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:79:69` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:80:70` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:81:32` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:81:54` ObjectLiteral -> `{}` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:81:68` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:82:69` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:83:32` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:83:55` ObjectLiteral -> `{}` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:83:69` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:84:81` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:85:78` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:86:70` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:87:32` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:87:56` ObjectLiteral -> `{}` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:87:70` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:88:82` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:89:32` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:89:61` ObjectLiteral -> `{}` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:89:75` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:90:32` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:90:61` ObjectLiteral -> `{}` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:90:75` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:91:32` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:91:72` ObjectLiteral -> `{}` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:91:86` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:92:67` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:93:32` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:93:53` ObjectLiteral -> `{}` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:93:67` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:94:79` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:95:76` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:96:32` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:96:62` ObjectLiteral -> `{}` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:96:76` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:97:87` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:98:68` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:99:32` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:99:54` ObjectLiteral -> `{}` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:99:68` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:100:80` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:101:68` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:102:32` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:102:54` ObjectLiteral -> `{}` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:102:68` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:103:80` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:104:71` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:105:32` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:105:57` ObjectLiteral -> `{}` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:105:71` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:106:83` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:107:32` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:107:59` ObjectLiteral -> `{}` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:107:73` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:108:32` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:108:59` ObjectLiteral -> `{}` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:108:73` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:109:32` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:109:70` ObjectLiteral -> `{}` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:109:84` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:110:77` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:111:71` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:112:32` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:112:57` ObjectLiteral -> `{}` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:112:71` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:113:83` BooleanLiteral -> `false` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:140:37` OptionalChaining -> `update.message.photo` — ran against 9 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:150:10` OptionalChaining -> `update.message.photo` — ran against 78 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:185:9` ConditionalExpression -> `true` — ran against 6 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:314:62` BlockStatement -> `{}` — ran against 48 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:315:9` BooleanLiteral -> `adapters.humanLoopRoot` — ran against 48 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:315:9` ConditionalExpression -> `true` — ran against 48 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:315:9` ConditionalExpression -> `false` — ran against 48 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:319:51` BlockStatement -> `{}` — ran against 21 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:320:9` BooleanLiteral -> `adapters.humanLoopRoot` — ran against 21 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:320:9` ConditionalExpression -> `true` — ran against 21 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:320:9` ConditionalExpression -> `false` — ran against 21 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:324:43` BlockStatement -> `{}` — ran against 7 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:325:9` BooleanLiteral -> `root` — ran against 7 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:325:9` ConditionalExpression -> `true` — ran against 7 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:325:9` ConditionalExpression -> `false` — ran against 7 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:343:9` ConditionalExpression -> `false` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:343:25` StringLiteral -> `""` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:378:9` ConditionalExpression -> `false` — ran against 19 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:413:9` ConditionalExpression -> `false` — ran against 16 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:413:27` StringLiteral -> `""` — ran against 16 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:413:38` BlockStatement -> `{}` — ran against 6 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:414:16` ObjectLiteral -> `{}` — ran against 6 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:416:22` ObjectLiteral -> `{}` — ran against 8 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:416:31` BooleanLiteral -> `true` — ran against 8 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:471:22` ObjectLiteral -> `{}` — ran against 23 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:506:38` StringLiteral -> `""` — ran against 8 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:507:40` StringLiteral -> `""` — ran against 8 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:534:11` ObjectLiteral -> `{}` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:535:25` BlockStatement -> `{}` — ran against 17 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:598:15` OptionalChaining -> `adapters.notifyApprovalsTopic(undefined, `${backlogId}: ${kind} recorded; landed in ${resu` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:601:45` MethodExpression -> `result.stderr` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:601:71` StringLiteral -> `"Stryker was here!"` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:602:15` OptionalChaining -> `adapters.notifyApprovalsTopic(undefined, `${backlogId}: ${kind} recorded but FAILED TO COM` — ran against 3 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:639:45` BooleanLiteral -> `true` — ran against 7 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:642:40` StringLiteral -> `""` — ran against 42 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:649:9` ConditionalExpression -> `false` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:654:9` ConditionalExpression -> `false` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:657:73` StringLiteral -> `""` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:658:21` ObjectLiteral -> `{}` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:658:29` StringLiteral -> `""` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:659:40` StringLiteral -> `""` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:662:12` ObjectLiteral -> `{}` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:662:23` BooleanLiteral -> `false` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:679:45` BooleanLiteral -> `true` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:728:99` ObjectLiteral -> `{}` — ran against 8 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:728:112` BooleanLiteral -> `false` — ran against 8 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:739:15` OptionalChaining -> `adapters.notifyApprovalsTopic(undefined, `${backlogId}: Expedite refused by the ${promotio` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:740:63` ObjectLiteral -> `{}` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:740:71` StringLiteral -> `""` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:744:9` ConditionalExpression -> `false` — ran against 14 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:763:15` OptionalChaining -> `adapters.clearPendingButtonAction(backlogId)` — ran against 5 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:774:75` StringLiteral -> `""` — ran against 3 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:791:9` ConditionalExpression -> `false` — ran against 30 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:791:29` StringLiteral -> `""` — ran against 30 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:813:15` OptionalChaining -> `adapters.notifyApprovalsTopic(topicId, `${backlogId} isn't awaiting approval.`)` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:814:16` StringLiteral -> `""` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:816:9` ConditionalExpression -> `true` — ran against 5 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:817:15` OptionalChaining -> `adapters.notifyApprovalsTopic(topicId, (0, expediteSafety_1.unsafeDispatchToastText)(resul` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:830:11` OptionalChaining -> `adapters.notifyApprovalsTopic(topicId, result.text)` — ran against 3 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:831:35` StringLiteral -> `""` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:835:16` StringLiteral -> `""` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:850:77` StringLiteral -> `""` — ran against 4 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:853:16` StringLiteral -> `""` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:864:9` ConditionalExpression -> `false` — ran against 19 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:864:29` StringLiteral -> `""` — ran against 19 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:876:29` OptionalChaining -> `adapters.getPendingRecertDelete()` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:878:16` StringLiteral -> `""` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:880:11` OptionalChaining -> `adapters.clearPendingRecertDelete()` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:881:26` OptionalChaining -> `adapters.queueRecertDeleteProposal(pendingId)` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:882:9` ConditionalExpression -> `false` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:895:31` OptionalChaining -> `adapters.isScenarioUpForRecert(scenarioId)` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:896:9` ConditionalExpression -> `false` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:900:11` OptionalChaining -> `adapters.setPendingRecertDelete(scenarioId)` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:901:11` OptionalChaining -> `adapters.notifyRecertTopic(topicId, `Reply "confirm" to delete ${scenarioId}, or anything ` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:915:9` ConditionalExpression -> `false` — ran against 10 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:915:29` StringLiteral -> `""` — ran against 10 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:915:52` BlockStatement -> `{}` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:916:16` StringLiteral -> `""` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:927:17` OptionalChaining -> `adapters.recordRecertValidate(scenarioId)` — ran against 4 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:928:17` OptionalChaining -> `adapters.queueRecertAmendProposal(scenarioId, annotateRoutedMediaText(decision.newText, up` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:931:16` StringLiteral -> `""` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:955:31` Regex -> `/(approve\ — ran against amend\ covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:955:31` Regex -> `/^(approve\ — ran against amend\ covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:962:35` Regex -> `/ask:([^:]+):(\d+)$/` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:962:35` Regex -> `/^ask:([^:]+):(\d+)/` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:962:35` Regex -> `/^ask:([^:]+):(\d)$/` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:963:36` Regex -> `/rule:([^:]+):(\d+)$/` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:963:36` Regex -> `/^rule:([^:]+):(\d+)/` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:963:36` Regex -> `/^rule:([^:]+):(\d)$/` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:971:22` OptionalChaining -> `callbackQuery.message?.chat.id` — ran against 57 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:971:22` OptionalChaining -> `callbackQuery.message.chat` — ran against 57 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:972:12` ConditionalExpression -> `true` — ran against 57 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:975:20` OptionalChaining -> `callbackQuery.from.id` — ran against 54 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:976:12` ConditionalExpression -> `true` — ran against 54 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1038:12` ConditionalExpression -> `true` — ran against 42 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1070:9` ConditionalExpression -> `false` — ran against 26 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1070:9` LogicalOperator -> `(decision.action === 'drop' \ — ran against decision.action === 'answer-ask') && decision.action === ` covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1070:9` ConditionalExpression -> `false` — ran against 26 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1070:9` LogicalOperator -> `decision.action === 'drop' && decision.action === 'answer-ask'` — ran against 26 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1070:9` ConditionalExpression -> `false` — ran against 26 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1070:29` StringLiteral -> `""` — ran against 26 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1070:39` ConditionalExpression -> `false` — ran against 24 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1070:59` StringLiteral -> `""` — ran against 24 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1070:75` ConditionalExpression -> `false` — ran against 24 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1070:95` StringLiteral -> `""` — ran against 24 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1070:103` BlockStatement -> `{}` — ran against 4 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1073:9` ConditionalExpression -> `true` — ran against 22 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1073:9` ConditionalExpression -> `false` — ran against 22 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1073:9` EqualityOperator -> `decision.action !== 'rule'` — ran against 22 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1073:29` StringLiteral -> `""` — ran against 22 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1107:9` ConditionalExpression -> `false` — ran against 10 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1107:19` BlockStatement -> `{}` — ran against 7 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1110:11` OptionalChaining -> `adapters.editAskMessage(message.topicId, message.messageId, composeText(message.text))` — ran against 3 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1123:9` ConditionalExpression -> `false` — ran against 13 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1124:16` BooleanLiteral -> `true` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1168:26` OptionalChaining -> `enqueueRoleAnswerNote(role, answerText, updateId)` — ran against 9 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1251:9` ConditionalExpression -> `true` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1252:25` OptionalChaining -> `callbackQuery.message.message_thread_id` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1271:23` OptionalChaining -> `adapters.notifyApprovalsTopic(callbackQuery.message?.message_thread_id, text)` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1271:55` OptionalChaining -> `callbackQuery.message.message_thread_id` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1320:44` StringLiteral -> `""` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1331:47` OptionalChaining -> `callbackQuery.message.message_thread_id` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1333:12` StringLiteral -> `""` — ran against 4 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1345:9` ConditionalExpression -> `false` — ran against 22 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1345:29` StringLiteral -> `""` — ran against 22 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1376:44` StringLiteral -> `""` — ran against 3 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1409:9` ConditionalExpression -> `false` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1453:16` StringLiteral -> `""` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1462:20` ConditionalExpression -> `false` — ran against 15 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1462:43` BooleanLiteral -> `false` — ran against 15 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1465:27` ObjectLiteral -> `{}` — ran against 15 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1488:9` LogicalOperator -> `!adapters.readRoleTopicMap && !adapters.redirectToRole` — ran against 110 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1497:12` ConditionalExpression -> `true` — ran against 12 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1524:58` StringLiteral -> `""` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1535:16` StringLiteral -> `""` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1551:15` OptionalChaining -> `adapters.setPendingControlConfirm({   kind: 'stop-modes' })` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1552:15` OptionalChaining -> `adapters.postControlStopModesMenu()` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1555:15` OptionalChaining -> `adapters.setPendingControlConfirm({   kind: 'restart-confirm' })` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1556:15` OptionalChaining -> `adapters.postControlRestartConfirm()` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1559:15` OptionalChaining -> `adapters.setPendingControlConfirm(undefined)` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1560:15` OptionalChaining -> `adapters.postControlCancelled()` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1563:15` OptionalChaining -> `adapters.setPendingControlConfirm(undefined)` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1564:15` OptionalChaining -> `adapters.executeEmergencyStop()` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1567:15` OptionalChaining -> `adapters.setPendingControlConfirm(undefined)` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1568:15` OptionalChaining -> `adapters.executeDrainStop()` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1571:15` OptionalChaining -> `adapters.setPendingControlConfirm(undefined)` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1572:15` OptionalChaining -> `adapters.executeRestart()` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1575:15` OptionalChaining -> `adapters.postControlPauseMenu()` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1578:15` OptionalChaining -> `adapters.resumeNow()` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1586:15` OptionalChaining -> `adapters.applyPause(decision.durationMs)` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1589:9` ConditionalExpression -> `false` — ran against 8 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1589:29` StringLiteral -> `""` — ran against 8 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1593:9` ConditionalExpression -> `false` — ran against 8 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1593:29` StringLiteral -> `""` — ran against 8 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1605:35` OptionalChaining -> `adapters.getPendingControlConfirm()` — ran against 14 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1606:31` OptionalChaining -> `adapters.getPauseState()` — ran against 14 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1626:12` ConditionalExpression -> `false` — ran against 7 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1646:9` ConditionalExpression -> `false` — ran against 6 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1649:27` StringLiteral -> `""` — ran against 6 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1649:64` OptionalChaining -> `update.message?.from.id` — ran against 6 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1649:64` OptionalChaining -> `update.message.from` — ran against 6 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1668:38` OptionalChaining -> `callbackQuery.data.startsWith` — ran against 10 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1675:32` OptionalChaining -> `callbackQuery.from.id` — ran against 9 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1676:18` OptionalChaining -> `callbackQuery.message.message_thread_id` — ran against 9 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1681:16` StringLiteral -> `""` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1685:16` StringLiteral -> `""` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1709:16` StringLiteral -> `""` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1711:35` OptionalChaining -> `adapters.getPendingAgentQuestionThread()` — ran against 3 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1738:16` StringLiteral -> `""` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1740:9` ConditionalExpression -> `false` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1740:9` LogicalOperator -> `!adapters.handleOnboarderMessage && topicId === undefined` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1740:45` ConditionalExpression -> `false` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1785:12` ConditionalExpression -> `true` — ran against 173 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1791:9` ConditionalExpression -> `false` — ran against 173 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1791:49` BlockStatement -> `{}` — ran against 158 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1813:66` BlockStatement -> `{}` — ran against 110 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1814:9` ConditionalExpression -> `true` — ran against 110 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1833:68` ConditionalExpression -> `false` — ran against 62 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1833:88` StringLiteral -> `""` — ran against 62 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1834:30` OptionalChaining -> `update.message.photo` — ran against 42 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1835:16` ObjectLiteral -> `{}` — ran against 71 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1835:24` StringLiteral -> `""` — ran against 71 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1838:9` ConditionalExpression -> `true` — ran against 3 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1839:9` OptionalChaining -> `adapters.logDropAudit(formatPhotoPersistFailureAuditLine(update.update_id, outcome.reason)` — ran against 1 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1849:9` ConditionalExpression -> `false` — ran against 110 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1956:9` StringLiteral -> `""` — ran against 12 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:1970:37` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/tools/telegramFrontDeskBotCore.js:2066:32` ConditionalExpression -> `false` — ran against 10 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2067:31` LogicalOperator -> `offsetAdvanced && result.failed === 0` — ran against 10 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2067:49` ConditionalExpression -> `false` — ran against 9 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2071:30` BooleanLiteral -> `true` — ran against 10 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2117:68` StringLiteral -> `"Stryker was here!"` — ran against 4 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2118:13` StringLiteral -> ```` — ran against 7 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2119:29` ConditionalExpression -> `true` — ran against 7 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2119:29` ConditionalExpression -> `false` — ran against 7 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2119:79` StringLiteral -> `""` — ran against 3 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2119:88` StringLiteral -> `""` — ran against 3 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2119:105` StringLiteral -> `""` — ran against 4 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2173:12` ConditionalExpression -> `true` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2223:9` ConditionalExpression -> `true` — ran against 8 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2223:9` EqualityOperator -> `cycle.delayMs >= 0` — ran against 8 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2241:9` OptionalChaining -> `onFault(name, error)` — ran against 2 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2256:20` MethodExpression -> `buffer` — ran against 34 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2260:63` OptionalChaining -> `dataLine.slice` — ran against 34 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2275:9` LogicalOperator -> `(!adapters.isVoiceOriginatedTurn \ — ran against !adapters.synthesizeVoice) && !adapters.sendVoice` covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2275:9` ConditionalExpression -> `false` — ran against 15 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2275:9` LogicalOperator -> `!adapters.isVoiceOriginatedTurn && !adapters.synthesizeVoice` — ran against 15 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2320:30` StringLiteral -> `"Stryker was here!"` — ran against 6 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2322:74` StringLiteral -> `"Stryker was here!"` — ran against 4 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2323:23` ArithmeticOperator -> `index - 1` — ran against 6 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2325:16` StringLiteral -> `"Stryker was here!"` — ran against 6 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2326:23` StringLiteral -> `""` — ran against 6 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2383:27` OptionalChaining -> `adapters.agentQuestionsTopicId()` — ran against 4 covering test(s), none caught it
- `out/tools/telegramFrontDeskBotCore.js:2401:27` OptionalChaining -> `adapters.roleTopicIdFor(role)` — ran against 9 covering test(s), none caught it
- `out/onboarding/negotiationTelegramRelay.js:8:35` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/onboarding/negotiationTelegramRelay.js:9:31` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/onboarding/negotiationTelegramRelay.js:13:34` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/onboarding/negotiationTelegramRelay.js:17:43` StringLiteral -> `""` — ran against whole suite, 605 tests, none caught it
- `out/onboarding/negotiationTelegramRouting.js:19:27` Regex -> `/\s*(all\s+)?(agree\ — ran against approve\ covering test(s), none caught it
- `out/onboarding/negotiationTelegramRouting.js:19:27` Regex -> `/^\S*(all\s+)?(agree\ — ran against approve\ covering test(s), none caught it
- `out/onboarding/negotiationTelegramRouting.js:19:27` Regex -> `/^\s*(all\s)?(agree\ — ran against approve\ covering test(s), none caught it
- `out/onboarding/negotiationTelegramRouting.js:19:27` Regex -> `/^\s*(all\s+)?(agree\ — ran against approve\ covering test(s), none caught it
- `out/onboarding/negotiationTelegramRouting.js:27:34` Regex -> `/\s*(not sure\ — ran against no idea\ covering test(s), none caught it
- `out/onboarding/negotiationTelegramRouting.js:27:34` Regex -> `/^\S*(not sure\ — ran against no idea\ covering test(s), none caught it
- `out/onboarding/negotiationTelegramRouting.js:27:34` Regex -> `/^\s*(not sure\ — ran against no idea\ covering test(s), none caught it
- `out/onboarding/negotiationTelegramRouting.js:27:34` Regex -> `/^\s*(not sure\ — ran against no idea\ covering test(s), none caught it
- `out/onboarding/negotiationTelegramRouting.js:27:34` Regex -> `/^\s*(not sure\ — ran against no idea\ covering test(s), none caught it
- `out/onboarding/negotiationTelegramRouting.js:27:34` Regex -> `/^\s*(not sure\ — ran against no idea\ covering test(s), none caught it
- `out/onboarding/negotiationTelegramRouting.js:83:75` StringLiteral -> `""` — ran against 9 covering test(s), none caught it

## No-coverage mutants (91), one line each — real coverage gaps, not "survivors" in Stryker's own sense but reported for completeness
- `out/tools/telegramFrontDeskBotCore.js:81:91` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:83:92` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:87:93` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:89:98` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:90:98` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:91:109` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:93:90` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:96:99` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:99:91` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:102:91` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:105:94` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:107:96` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:108:96` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:109:107` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:112:94` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:343:41` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:344:40` StringLiteral -> ```` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:344:80` StringLiteral -> `""` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:345:16` StringLiteral -> ```` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:456:34` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:457:24` ArrowFunction -> `() => undefined` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:544:82` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:649:24` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:650:16` ObjectLiteral -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:650:27` BooleanLiteral -> `true` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:650:45` BooleanLiteral -> `true` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:654:19` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:655:16` ObjectLiteral -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:655:27` BooleanLiteral -> `true` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:655:45` BooleanLiteral -> `true` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:744:28` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:749:15` OptionalChaining -> `adapters.notifyApprovalsTopic(undefined, `${backlogId}: ${(0, expediteSafety_1.crossedCapT` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:749:58` StringLiteral -> ```` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:882:18` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:883:15` OptionalChaining -> `adapters.notifyRecertTopic(topicId, `${pendingId} isn't awaiting recertification.`)` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:883:53` StringLiteral -> ```` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:884:16` StringLiteral -> `""` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:896:23` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:897:15` OptionalChaining -> `adapters.notifyRecertTopic(topicId, `${scenarioId} isn't awaiting recertification.`)` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:897:53` StringLiteral -> ```` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:898:16` StringLiteral -> `""` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1073:37` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1074:38` OptionalChaining -> `adapters.readRecordedRuling(decision.backlogId)` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1075:13` ConditionalExpression -> `true` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1075:13` ConditionalExpression -> `false` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1075:29` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1077:20` BooleanLiteral -> `false` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1201:101` ObjectLiteral -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1201:109` StringLiteral -> `""` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1255:35` StringLiteral -> `""` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1271:107` BooleanLiteral -> `true` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1302:72` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1303:27` OptionalChaining -> `adapters.resolveRulingOptions(decision.backlogId)` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1304:19` OptionalChaining -> `options[decision.optionIndex]` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1305:9` BooleanLiteral -> `label` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1305:9` ConditionalExpression -> `true` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1305:9` ConditionalExpression -> `false` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1305:17` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1307:60` StringLiteral -> `""` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1308:16` StringLiteral -> `""` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1310:104` ArrowFunction -> `() => undefined` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1311:29` StringLiteral -> `""` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1311:40` StringLiteral -> `""` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1345:37` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1409:37` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1410:16` StringLiteral -> `""` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1463:11` ObjectLiteral -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1463:19` StringLiteral -> `""` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1580:46` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1581:15` OptionalChaining -> `adapters.releaseAmbulance()` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1589:49` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1590:15` OptionalChaining -> `adapters.engageAmbulance(decision.ticket)` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1593:56` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1594:15` OptionalChaining -> `adapters.executeSharedOperator(decision.verb, decision.args)` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1606:62` ObjectLiteral -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1606:72` BooleanLiteral -> `true` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1614:18` StringLiteral -> `"Stryker was here!"` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1646:16` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1647:16` StringLiteral -> `""` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1740:68` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1741:16` StringLiteral -> `""` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1817:105` LogicalOperator -> `update.message?.text && ''` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1817:105` OptionalChaining -> `update.message.text` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1817:129` StringLiteral -> `"Stryker was here!"` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1818:12` ConditionalExpression -> `true` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1818:12` ConditionalExpression -> `false` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1818:12` EqualityOperator -> `outcome !== 'not-mine'` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1818:24` StringLiteral -> `""` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1818:49` StringLiteral -> `""` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:1849:34` BlockStatement -> `{}` — no test in this row's include set executes this code
- `out/tools/telegramFrontDeskBotCore.js:2260:99` StringLiteral -> `"Stryker was here!"` — no test in this row's include set executes this code

## Verification

| check | result |
|---|---|
| `mutation_cooldown_gate.bb` × 3 files | `run` (22.16 / 22.16 / 2.78 days) |
| host load, pre-launch | `2.32/20` (quiet) |
| `node scripts/ensureStrykerSandboxSiblings.js` | all 6 siblings verified, none newly created |
| `npx stryker run stryker.bl1441bl955.config.json` | 2195 mutants, 1795 killed, 303 survived, 91 no coverage, 6 timeout, 0 errors — completed run, 9m47s |
| `bb hardening_debt_ledger_read.bb .` (before discharge) | BL-955 row: `attempted_at: 2026-09-08`, `discharged_at: null` |

## Scope

Nothing in `out_of_scope` touched. No mutant suppressed, no test authored
to chase survivors — hardener's next-stage work against this evidence.
