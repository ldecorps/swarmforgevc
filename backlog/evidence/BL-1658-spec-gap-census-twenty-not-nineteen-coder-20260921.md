# BL-1658 spec-gap: the census grep is 20, not 19 (coder, 2026-09-21)

## What happened

Implementing amendment (3)'s scenario 03 ("the census grep over
specs/pipeline/steps for cursorBridgeAgentSession names exactly nineteen
handlers of which fifteen were eager at mint"), the real grep over the
real tree names TWENTY files, not nineteen:

```
bl1050CursorRunFailureLogSteps.js, bl1116ExtensionWipHotfixStampOffSteps.js,
bl1146HostQueueEnqueueNextHoldOnHostQuestionSteps.js,
bl1207AbandonedLockLivenessSteps.js, bl1253DeadFeederOwnsGetUpdatesStampSteps.js,
bl1322BridgeLazyCursorApiKeySteps.js, bl1384LocalSeatTopicForwardedSteps.js,
bl545CatchUpPagerSteps.js, bl696LetsTalkSteps.js,
bl696TelegramCursorBridgeOperatorSteps.js, bl697LetsTalkHandsFreeSteps.js,
bl717SilentReturnAfterHoldMusicSteps.js, bl718BubbleTalkMirrorSteps.js,
bl720EnvRestoreGuardSteps.js, bl767QueuedBridgeQuestionsAnswerInOriginTopicSteps.js,
bl790BridgeQueuesNoteForRoleSteps.js, bl810HostQueuePollClearAllTtlSteps.js,
bl894QueueRepostsSelectionPollSteps.js, bl915CursorBridgeGoneAgentSessionResetSteps.js,
bl941CursorGoneAgentClassifierBoundariesSteps.js
```

The extra one against the ticket's own prior count (which named
bl1116/bl720/bl915/bl941 as the four already-lazy, non-eager references,
19 total) is `bl1207AbandonedLockLivenessSteps.js` - its own commit
(`f61cbabf76`, 2026-08-28, weeks before this ticket) already lazy-loads
the module correctly (`MODULE_PATH` const, `require(MODULE_PATH)` inside
a function at lines 18-19) - not an eager offender, not part of the
fifteen. It was simply missed by whichever census produced "nineteen".

## Fix implemented (in this parcel, pending confirmation)

The fifteen-handler Examples table and the actual production fixes are
unaffected - bl1207 needed no code change. Adjusted only the acceptance
step's expected count from nineteen to twenty in
`bl1658SevenJsdomHandlersLoadLazilySteps.js`, and the feature file's
scenario 03 wording, matching the verified real-tree grep. Continuing
with this fix while awaiting confirmation, per this session's own
precedent for a same-shape count/scope miscount (BL-1677's bl1239).

By coder.
