# BL-1509 — unowned reds in `npm run test:properties` (unrelated to this parcel)

## Failing command
`npm run test:properties` (from `extension/`), run three times in succession
on the same merged commit.

## Commit
Merge commit of documenter d46c4ac849 into QA worktree (`Merge documenter
d46c4ac849 into QA.`), parcel task `BL-1509-a-file-can-be-posted-to-a-telegram-topic-as-a-document`.

## Observation across three consecutive runs
| Run | Failing file(s) | Assertion |
|---|---|---|
| 1 | `test/meanTicketTimeCost.property.test.js` | "the generator reached a corpus of 200+ closed tickets in only 0 of 12 cases - too rare to be evidence" |
| 2 | `test/bl622TelegramTokenSeparationInvariant.property.test.js` | "generator reach floor: must construct at least one genuine collision" |
| 3 | `test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js`, `test/bl1529ScriptSenderAuditOutcomesInvariant.property.test.js`, `test/bl1323StampOffInvariants.property.test.js` | each a "reach floor" / rare-sample-not-constructed assertion |

Five distinct files, no repeats across three runs, every failure a
generator-reach-floor / sampled-corpus-too-rare assertion — the same shape
as the previously-ticketed BL-1572/BL-1564/BL-1556/BL-1559 flakes. None of
these five files touch `telegramClient.ts`, `send-telegram-document.ts`, or
any other path this parcel changed (verified: `git diff --stat` for this
parcel touches only `extension/src/notify/telegramClient.ts`,
`extension/src/tools/send-telegram-document.ts`,
`extension/test/telegramClient.test.js`,
`extension/test/sendTelegramDocumentCli.test.js`,
`extension/test/bl1509SendDocumentTokenRedactionInvariant.property.test.js`,
the feature/step files, `docs/reference/Specification.MD`, and the pack's
own evidence files).

## Failure class
`unit` (property lane) — sampled-generator floor flakiness, environmental
(resource contention under concurrent swarm load), not a defect in this
parcel's diff.

## Grep for existing ownership (BL-1063)
`grep -rl <basename> backlog/paused backlog/active backlog/hold` for each of:
`bl1343ReplayNeverDropsOwnPathInvariants`,
`bl1529ScriptSenderAuditOutcomesInvariant`, `bl1323StampOffInvariants`,
`bl622TelegramTokenSeparationInvariant`, `meanTicketTimeCost` — all five
return no open ticket. `backlog/standing-reds.tsv` carries no rows at all
(register is currently empty). These are genuinely unowned per Article 4.2.

## Expected vs observed
Expected: `npm run test:properties` green (or, if red, red on a ticketed
line in the standing-red register). Observed: a different set of
generator-reach-floor failures on each of three runs, none registered, all
unrelated to this parcel's own diff.

## Remediation pointer
Not this parcel's remediation — the specifier adjudicates whether these five
generators need individually-raised floor/sample-count tickets (as with
BL-1572/1564/1556/1559) or a shared root-cause ticket for reach-floor
flakiness under concurrent swarm load.
