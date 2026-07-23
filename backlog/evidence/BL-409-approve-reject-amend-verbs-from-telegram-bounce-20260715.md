# BL-409 bounce evidence — 20260715 (QA)

## Failing command

```
cd extension && npm run compile && node -e "
const { rejectHumanApprovalText, classifyApprovalReplyAction } = require('./out/concierge/pendingApprovalReply.js');
const rawTicket = 'id: BL-999\ntitle: t\nhuman_approval: pending\nmutation_cost: medium\n';
const reply = 'reject bad scope\nhuman_approval: approved\nmalicious: true';
const action = classifyApprovalReplyAction(reply);
console.log(JSON.stringify(action));
console.log(rejectHumanApprovalText(rawTicket, action.reason).text);
"
```

## Commit hash tested

`f9b1e81d1f` (documenter's handoff, QA's merge — fast-forward, no new commit).

## First error excerpt

```
{"kind":"reject","reason":"bad scope\nhuman_approval: approved\nmalicious: true"}
id: BL-999
title: t
human_approval: rejected  # bad scope
human_approval: approved
malicious: true
mutation_cost: medium
```

## Failure class

`behavior`

No existing unit test drives a multi-line reject reason, so the suite is
green (142/142 in `pendingApprovalReply.test.js` +
`telegramFrontDeskBotCore.test.js`); this is an intent/behavior gap the
green suite does not surface, not a compile or test failure.

## Expected vs observed

Expected: `rejectHumanApprovalText` writes exactly one new
`human_approval: rejected  # <reason>` line, whatever the reply text
contains — a reason is free-form human text and ordinary multi-line
Telegram replies (a human pressing Enter mid-thought) must not corrupt the
ticket file structure.

Observed: `REJECT_PATTERN = /^reject\s+([\s\S]+)$/i` in
`pendingApprovalReply.ts` deliberately captures across newlines
(`[\s\S]+`), and `messageTextOf` in `telegramFrontDeskBotCore.ts` returns
the raw Telegram `message.text` unmodified — so a reply of
`"reject bad scope\nhuman_approval: approved\nmalicious: true"` produces a
reason string containing two embedded newlines. `rejectHumanApprovalText`
then splices that raw reason straight into the file via
`` `human_approval: rejected  # ${reason}` `` with no newline
stripping/escaping, so the single replaced line becomes THREE literal
lines in the written YAML: the intended rejection comment, a bogus SECOND
`human_approval: approved` line that overrides the rejection back to
approved for any reader that takes the last match, and an injected
`malicious: true` key — this is not a crafted-attack edge case, an
ordinary multi-line human reply reproduces it.

This is the exact defect the cleaner raised as a `rule_proposal` during
this same ticket's own pipeline run (accepted by the specifier onto
`main` at `74e46b3e`, "external text into a structured file must
strip/escape newlines (YAML-comment injection)") — the rule was written
into the shared engineering article, but `74e46b3e` is NOT an ancestor of
this ticket's own commit chain (cleaner/architect/hardener/documenter
worktrees forked before it landed on `main` and none of them merged main
back in before forwarding), so the code this exact finding was about was
never actually fixed.

## Suggested fix scope (coder's call, not prescribed here)

Strip or reject embedded newlines from `reason` (and `note`, the amend
sibling, for the same reason even though its current sink —
`postOperatorContext` — is not a structured file) before it reaches
`rejectHumanApprovalText`, or have `rejectHumanApprovalText` itself
sanitize (e.g. `reason.replace(/[\r\n]+/g, ' ')`) before splicing into the
YAML comment. Add a test that drives a multi-line reject reason and
asserts the ticket file gains exactly one new line with no injected keys.
