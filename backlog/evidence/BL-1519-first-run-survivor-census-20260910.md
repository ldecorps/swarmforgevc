# BL-1519 — first-run survivor census over the six files BL-1441 discharged, 2026-09-10

Specifier record, made while adjudicating the hardender's `rule_proposal`
of 2026-09-10 (scope `role:hardender`, inbound
`00_20260910T202509Z_001262_from_hardender_to_specifier_for_specifier`).
It is the partition basis for the ruling BL-1519 carries and for the two
slices minted with it (BL-1520, BL-1521). Counts are read from the three
discharge evidence files on the hardender's tip `5112a3fa5b`
(`backlog/evidence/BL-1441-BL-620-mutation.md`,
`BL-1441-BL-955-mutation.md`,
`BL-1441-BL-956-pipeline-board-caption-and-cap-hotfix-mutation.md`), each
mutant attributed to the enclosing top-level declaration of the compiled
file at the line Stryker reported (`.worktrees/hardender/extension/out/`,
compiled 2026-09-10 15:46). `<module-top>`/`telegramTopicDecisions_1` mean
module-level code after the last `require` (constant and pattern tables).

Two caveats the counts carry, both from the evidence itself:

- `NoCoverage` is measured against each row's SCOPED dry-run include set
  (17 test files for BL-620's row, 9 for BL-955's), not the whole unit
  suite. A no-coverage mutant here is "no test in this include set reached
  it". Every owner slice re-measures over the full unit suite first.
- `telegramFrontDeskBotCore.ts` sits in two file sets and was run twice
  with different include sets (262/78 in BL-620's row, 288/91 in BL-955's).
  The larger pair is used below.

## Totals (survived / no-coverage / mutants instrumented)

| File | Survived | No-cov | Total mutants | Score | Owner |
|---|---|---|---|---|---|
| extension/src/tools/telegram-front-desk-bot.ts | 285 | 654 | 1945 | 51.72% | BL-1519 ruling |
| extension/src/tools/telegramFrontDeskBotCore.ts | 288 | 91 | 2048 (BL-955 row) | 81.49% | BL-1519 ruling |
| extension/src/concierge/pipelineBoard.ts | 177 | 39 | 1028 | 78.99% | BL-1519 ruling |
| extension/src/tools/telegramTopicDecisions.ts | 26 | 0 | 234 | 88.89% | BL-1520 |
| extension/src/onboarding/negotiationTelegramRouting.ts | 11 | 0 | 86 | 87.21% | BL-1521 |
| extension/src/onboarding/negotiationTelegramRelay.ts | 4 | 0 | 61 | 93.44% | BL-1521 |

## Per-function census (survived s / no-coverage n), top entries

### 620|out/tools/telegram-front-desk-bot.js  surv=285 nocov=654
  functions=130
   156  buildPollAdapters  (s0/n156)
   125  buildConciergeTickAdapters  (s0/n125)
    84  applyHotfixStampAnswer  (s0/n84)
    54  candidateApprovalsTopicIds  (s35/n19)
    37  connectAndRelayReplies  (s0/n37)
    17  redirectToRole  (s8/n9)
    15  main  (s0/n15)
    13  openSubjectAndRecord  (s10/n3)
    13  ackReply  (s0/n13)
    12  postToBridge  (s0/n12)
    11  ensureApprovalsTopic  (s9/n2)
    11  subscribeReplies  (s0/n11)
    10  buildVoiceReplyAdapters  (s0/n10)
    10  buildTopicDeletionAdapters  (s0/n10)
     9  readCursorBridgeTopicId  (s5/n4)
     9  provisionRoleTopic  (s8/n1)
     9  pruneMediaStore  (s6/n3)
     9  readRootIntakeFiles  (s8/n1)
     9  pollLoop  (s0/n9)
     8  openSubject  (s8/n0)
     7  ensureResidentSpyTopic  (s3/n4)
     7  sendDirectEscalation  (s0/n7)
     6  persistRoutedPhoto  (s4/n2)
     6  synthesizeVoiceReply  (s6/n0)
     6  scopeTextFor  (s3/n3)
     6  readFrontDeskTopicMap  (s0/n6)
     6  updateApprovalAskMessageText  (s0/n6)
     6  postToBridgeOrHotfixStamp  (s0/n6)
     6  plainTextEditInPlaceAdapters  (s0/n6)
     6  conciergeTickLoopWithScheduler  (s0/n6)
  ... 100 more functions, 256 mutants

### 620|out/tools/telegramFrontDeskBotCore.js  surv=262 nocov=78
  functions=78
    50  telegramTopicDecisions_1  (s48/n2)
    21  answerIfAlreadyDecided  (s15/n6)
    16  recordRulingDecisionAndClose  (s8/n8)
    16  CONTROL_DECISION_EFFECTS  (s14/n2)
    12  dispatchRuleCallback  (s0/n12)
    10  attemptProviderChatSeatDelivery  (s2/n8)
     9  recordExpediteDecisionAndClose  (s6/n3)
     9  deliverRecertConfirmDelete  (s5/n4)
     9  applyControlDecision  (s5/n4)
     8  deliverRecertDeleteRequest  (s4/n4)
     7  deliverRecertTopicReply  (s7/n0)
     7  persistPhotoIfRouted  (s7/n0)
     7  applyPollCycleResult  (s7/n0)
     6  formatSteerReceipt  (s2/n4)
     6  normalizePromotionOutcome  (s6/n0)
     6  processSteeringUpdate  (s4/n2)
     6  attemptControlTextDelivery  (s4/n2)
     6  attemptOnboardingTopicDelivery  (s4/n2)
     5  attemptControlCallbackDelivery  (s5/n0)
     5  composeAskMessageBody  (s5/n0)
     4  emitApprovalTapTelemetry  (s4/n0)
     4  emitSteeringTelemetry  (s4/n0)
     4  emitPollTelemetry  (s4/n0)
     4  commitApprovalDecision  (s4/n0)
     4  deliverApprovalsTopicQjump  (s4/n0)
     4  gatherControlState  (s2/n2)
     4  runPollCycle  (s4/n0)
     3  deliverApprovalsTopicReply  (s3/n0)
     3  ASK_CALLBACK_DATA_PATTERN  (s3/n0)
     3  RULE_CALLBACK_DATA_PATTERN  (s3/n0)
  ... 48 more functions, 82 mutants

### 955|out/tools/telegramFrontDeskBotCore.js  surv=288 nocov=91
  functions=78
    89  telegramTopicDecisions_1  (s74/n15)
    21  answerIfAlreadyDecided  (s15/n6)
    16  recordRulingDecisionAndClose  (s8/n8)
    16  CONTROL_DECISION_EFFECTS  (s14/n2)
    12  dispatchRuleCallback  (s0/n12)
    10  attemptProviderChatSeatDelivery  (s2/n8)
     9  recordExpediteDecisionAndClose  (s6/n3)
     9  deliverRecertConfirmDelete  (s5/n4)
     9  applyControlDecision  (s5/n4)
     8  deliverRecertDeleteRequest  (s4/n4)
     7  deliverRecertTopicReply  (s7/n0)
     7  persistPhotoIfRouted  (s7/n0)
     7  applyPollCycleResult  (s7/n0)
     6  formatSteerReceipt  (s2/n4)
     6  normalizePromotionOutcome  (s6/n0)
     6  processSteeringUpdate  (s4/n2)
     6  attemptControlTextDelivery  (s4/n2)
     6  attemptOnboardingTopicDelivery  (s4/n2)
     5  attemptControlCallbackDelivery  (s5/n0)
     5  composeAskMessageBody  (s5/n0)
     4  emitApprovalTapTelemetry  (s4/n0)
     4  emitSteeringTelemetry  (s4/n0)
     4  emitPollTelemetry  (s4/n0)
     4  commitApprovalDecision  (s4/n0)
     4  deliverApprovalsTopicQjump  (s4/n0)
     4  gatherControlState  (s2/n2)
     4  runPollCycle  (s4/n0)
     3  deliverApprovalsTopicReply  (s3/n0)
     3  ASK_CALLBACK_DATA_PATTERN  (s3/n0)
     3  RULE_CALLBACK_DATA_PATTERN  (s3/n0)
  ... 48 more functions, 82 mutants

### 620|out/tools/telegramTopicDecisions.js  surv=26 nocov=0
  functions=10
     8  decideEnsureApprovalsTopicAction  (s8/n0)
     4  decideEnsurePipelineBoardTopicAction  (s4/n0)
     3  isFromPrincipal  (s3/n0)
     3  isFromMyChat  (s3/n0)
     2  messageTextOf  (s2/n0)
     2  decideEnsureResidentSpyTopicAction  (s2/n0)
     1  DEFAULT_SUBJECT_KEY  (s1/n0)
     1  BABYSITTER_SUBJECT_ID  (s1/n0)
     1  BABYSITTER_TOPIC_NAME  (s1/n0)
     1  PIPELINE_BOARD_SUBJECT_ID  (s1/n0)

### 955|out/onboarding/negotiationTelegramRelay.js  surv=4 nocov=0
  functions=4
     1  CONTRACT_AGREED_MESSAGE  (s1/n0)
     1  ROUND_LIMIT_MESSAGE  (s1/n0)
     1  CLARIFY_INTENT_MESSAGE  (s1/n0)
     1  COULD_NOT_DERIVE_CHANGE_MESSAGE  (s1/n0)

### 955|out/onboarding/negotiationTelegramRouting.js  surv=11 nocov=0
  functions=3
     6  AMBIGUOUS_INTENT_PATTERN  (s6/n0)
     4  AGREEMENT_PATTERN  (s4/n0)
     1  renderBulletList  (s1/n0)

### 956|out/concierge/pipelineBoard.js  surv=177 nocov=39
  functions=41
    20  formatCollapsedEpicLineHtml  (s14/n6)
    19  composePipelineBoardHtml  (s16/n3)
    17  renderListSectionHtml  (s11/n6)
    16  renderParkedSectionHtml  (s14/n2)
    14  renderGridTapLinesHtml  (s12/n2)
     9  renderListSection  (s4/n5)
     8  buildGridRows  (s8/n0)
     8  gridCaptionLine  (s7/n1)
     8  trimLinksToBudget  (s8/n0)
     8  budgetPipelineBoardLinks  (s8/n0)
     7  renderGridLines  (s7/n0)
     7  listSectionTicketIds  (s5/n2)
     7  buildPipelineBoardHtml  (s6/n1)
     6  renderGridCaptionLines  (s6/n0)
     5  renderParkedSection  (s5/n0)
     5  linksFromCollapsedEpics  (s0/n5)
     4  deriveKebabSlug  (s4/n0)
     4  comparePausedByPriority  (s4/n0)
     4  buildCollapsedEpicEntries  (s2/n2)
     4  HEALTH_DOT_GLYPHS  (s4/n0)
     4  renderPipelineBoardGridOnly  (s4/n0)
     4  formatBoardListLineHtml  (s4/n0)
     3  formatTicketIdHtml  (s3/n0)
     2  resolveRowSwarm  (s2/n0)
     2  TICKET_ID_PREFIX_PATTERN  (s2/n0)
     2  countEpicSliceChildren  (s2/n0)
     2  padStartNbsp  (s2/n0)
     2  captionsNeedSwarmBadges  (s2/n0)
     2  buildHeldEntries  (s2/n0)
     2  formatUpdatedAtLabel  (s1/n1)
  ... 11 more functions, 11 mutants

## How it was counted (re-run this, do not re-derive)

```
node census.js <dir-holding-the-three-evidence-files>
```
where `census.js` is:

```js
const fs=require('fs');const path=require('path');
const S=process.argv[2], WT='/home/carillon/swarmforgevc/.worktrees/hardender/extension/';
const files=['BL-1441-BL-620-mutation.md','BL-1441-BL-955-mutation.md','BL-1441-BL-956-pipeline-board-caption-and-cap-hotfix-mutation.md'];
const per={}; // file -> {surv:{fn:n}, nocov:{fn:n}}
const srcCache={};
function enclosing(file,line){ if(!srcCache[file]) srcCache[file]=fs.readFileSync(WT+file,'utf8').split('\n'); const L=srcCache[file]; for(let i=line-1;i>=0;i--){const t=L[i]; let m=/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)/.exec(t)||/^(?:exports\.|const |let |var )([A-Za-z0-9_$]+)\s*=/.exec(t)||/^class\s+([A-Za-z0-9_$]+)/.exec(t); if(m) return m[1]; if(/^\}/.test(t)&&i<line-1&&L[i].trim()==='}'){ /* top-level close before our line means we're between functions */ }} return '<module-top>'; }
for(const f of files){ const txt=fs.readFileSync(path.join(S,f),'utf8'); let mode=null; for(const raw of txt.split('\n')){ if(/^## Survived mutants/.test(raw)) mode='surv'; else if(/^## No-coverage mutants/.test(raw)) mode='nocov'; else if(/^## /.test(raw)) mode=null; if(!mode) continue; const m=/^- `(out\/[^:`]+):(\d+):(\d+)`/.exec(raw); if(!m) continue; const file=m[1], line=+m[2]; const key=f.split('-')[3]+'|'+file; per[file]=per[file]||{}; per[file][key]=per[file][key]||{surv:{},nocov:{},total:{surv:0,nocov:0}}; const fn=enclosing(file,line); const b=per[file][key]; b[mode][fn]=(b[mode][fn]||0)+1; b.total[mode]++; } }
for(const file of Object.keys(per)){ for(const key of Object.keys(per[file])){ const b=per[file][key]; console.log(`\n### ${key}  surv=${b.total.surv} nocov=${b.total.nocov}`); const fns={}; for(const k of Object.keys(b.surv)) fns[k]=(fns[k]||0)+b.surv[k]; for(const k of Object.keys(b.nocov)) fns[k]=(fns[k]||0)+b.nocov[k]; const rows=Object.entries(fns).sort((a,b)=>b[1]-a[1]); console.log(`  functions=${rows.length}`); for(const [fn,n] of rows.slice(0,30)) console.log(`  ${String(n).padStart(4)}  ${fn}  (s${b.surv[fn]||0}/n${b.nocov[fn]||0})`); if(rows.length>30) console.log(`  ... ${rows.length-30} more functions, ${rows.slice(30).reduce((a,r)=>a+r[1],0)} mutants`); } }
```
