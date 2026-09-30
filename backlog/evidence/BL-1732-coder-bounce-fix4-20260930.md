# BL-1732 — coder bounce fix, 2026-09-30 (QA bounce, evidence 256a0d4da0)

Four defects, all blamed coder.

## D1 — same-day same-goal intake overwrite

`intakeFileRelPath` now takes an optional `existsAt` checker and walks a
`-2`, `-3`, ... suffix until it finds a path nothing already occupies;
`submitIntake` wires it against the real filesystem
(`fs.existsSync(path.join(targetPath, p))`). Omitted, the function stays
the pure base-path shape existing callers/tests already use.

## D2 — an abandoned "add new" value still joined the shared vocabulary

- Server: `submitIntake` now promotes only `newValues[slot]` entries that
  equal the draft's OWN chosen value for that slot (`usedNewValues`) -
  invariant 1 checked at the actual call site, not just inside
  `promoteVocabulary` (which was never the buggy layer - it already
  promotes exactly what it is given).
- Client: `intakeFormUiHtml.ts`'s dropdown `change` handler now clears
  `newValues[slot]` when the selection moves away from the value that
  slot's `newValues` entry names - the leftover reference is what let an
  abandoned value ride the next Submit in the first place.
- `bl1732VocabularyPromotionInvariant.property.test.js`: a second
  property drives the REAL `submitIntake` (not just `promoteVocabulary`)
  with `newValues` generated INDEPENDENTLY of the draft's own chosen slot
  values, and asserts a value joins the shared vocabulary if and only if
  it is that slot's actual chosen value - per QA's own remediation
  pointer.

## D3 — a failed commit left the INTAKE file and the promoted vocabulary on disk

`commit-with-integrity` restores only the git INDEX, never a working-tree
file it did not itself write - the comment claiming otherwise was wrong.
`submitIntake` now captures the vocabulary file's exact prior text (or
its absence) before writing anything, and on `!result.success` removes
the INTAKE file it wrote and restores the vocabulary file to exactly
that prior state (deleting it if it did not exist before). A refused
Submit now files nothing and shares nothing, matching the ticket's own
"form shows Refused" contract.

## D4 — the way-in had no url/web_app button

`telegramTopicDecisions.ts`: `buildIntakeTopicButtons` (a plain `url:`
button - forum topics reject `web_app:`, `residentSpyTunnelNotify.ts`'s
own finding) and `buildIntakePrivateWebAppButtons` (the real Mini App
button, for a SEPARATE message to the principal's own private chat -
`notify-resident-spy-tunnel.ts`'s own precedent). `deliverIntakeTopicReply`
(telegramFrontDeskBotCore.ts) now builds the topic button from the
resolved form URL and posts it with the reply; when the reply is
`way-in`, it also posts the private-chat message through a new
`notifyIntakePrivateChat` adapter. `PollAdapters.notifyIntakeTopic` grew
an optional `buttons` parameter; `buildPollAdapters` (telegram-front-
desk-bot.ts) grew a `principalUserId` parameter (already in scope at its
one call site, `pollLoop`) and wires both adapters through the real
`sendTelegramMessage`.

## Verification

- `cd extension && npm run compile`: clean.
- `cd extension && npx vitest run test/intakeWriter.test.js`: 16 tests,
  all pass (4 new: D1's two-same-day-same-goal case, D2's abandoned-value
  case, D3's two failure-path cases). Each new test verified non-vacuous
  by hand: reverting the corresponding fix in isolation made exactly the
  matching new test(s) fail, nothing else; restored.
- `cd extension && npx vitest run test/intakeFormUiHtml.test.js`: 10
  tests, all pass (1 new: D2's client-side dropdown-switch case).
  Non-vacuous: reverting the `else if` branch failed exactly this test.
- `cd extension && npx vitest run test/telegramFrontDeskBotCore.test.js`:
  475 tests, all pass (2 extended for D4's button shape, matching
  non-vacuous by hand). Non-vacuous: reverting `deliverIntakeTopicReply`
  to its pre-fix body failed exactly the extended assertions.
- `cd extension && npx vitest run --config vitest.properties.config.mjs test/bl1732VocabularyPromotionInvariant.property.test.js`:
  2 tests, both pass. Non-vacuous: reverting the D2 server fix made the
  new property fail on its first shrunk counterexample.
- `cd extension && npm test`: 645 files, 10986 tests, all green.
- `node specs/pipeline/cli.js specs/features/BL-1732-the-intake-topic-opens-a-form-that-files-an-intake.feature`:
  10 of 10 ok, unaffected (no scenario submits twice same-day, switches a
  dropdown after add-new, fails a commit, or inspects the way-in's
  button shape - exactly QA's own "green lanes do not clear D1-D4" note).
- `cd extension && node out/tools/dependency-gate.js`: PASSED, no
  forbidden edges.

## Scope

Only the four remediation pointers QA named, plus the tests it asked
for. The QA "Observation (not a D-item)" about `seedVocabularyIfMissing`
running on a GET route is out of this bounce's scope, left untouched.

By coder.
