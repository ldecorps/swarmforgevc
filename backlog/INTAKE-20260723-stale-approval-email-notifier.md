# Human directive — email escalation for stale approval-asks, with a Telegram deep link

**From:** human (via Claude Code coordinator session)
**Date:** 2026-07-23
**Authority:** human-requested

## Problem

Today, an `ApprovalRequested` event posts to the standing **"Approvals"** Telegram
topic (`extension/src/tools/telegramFrontDeskBotCore.ts:197`,
`APPROVALS_TOPIC_NAME`) via `routeApprovalRequestedEvent` /
`sendApprovalAskAndRecord` (`extension/src/concierge/topicRouter.ts:457`), and the
human answers by tapping a button or replying in that topic
(`extension/src/concierge/pendingApprovalReply.ts`,
`telegramFrontDeskBotCore.ts:~725`). If the human misses it — away from Telegram,
notification lost in the noise, etc. — there is **no escalation**: the ticket just
sits with `human_approval: pending` indefinitely, silently blocking whatever
depends on it.

The human wants: an email sent when an approval-ask has stayed unanswered past a
threshold, with a **link straight to the Telegram Approvals topic** in the email
body so they can act on it from the email itself.

## What already exists (reuse, don't rebuild)

- **Email sending:** `extension/src/notify/resendClient.ts` (`sendResendEmail`,
  wraps the Resend API, redacts the key from errors). Two existing consumers
  already follow the pattern to copy: `extension/src/notify/needsHumanEmailNotifier.ts`
  (`NeedsHumanEmailNotifier`, config shape `{enabled, graceSeconds,
  cooldownSeconds, to, from}`, `decideNotifyAction` grace+cooldown state
  machine returning `send|wait|cooldown|skip`) — one instance in SwarmPanel
  (question detection, BL-073), one in `extension/src/extension.ts:361`
  (`stuckEscalationNotifier`, BL-148, reads
  `swarmforge.notify.email.{to,from,graceSeconds,cooldownSeconds}` VS Code
  config, resolves the API key via `resolveResendApiKey(context.secrets)`).
  **This ticket is naturally a third `NeedsHumanEmailNotifier`-shaped instance**
  (or a shared adapter), not a new email pipeline.
- **Approval state + where the ask lives:** ticket YAML `human_approval` field
  (`pending`/`approved`/`amending`/etc.); per-ticket message tracking in
  `extension/src/concierge/blTopicStore.ts` (durable, git-tracked) and
  `extension/src/concierge/ticketMessageMapStore.ts` (gitignored
  `{topicId, messageId}` map at `.swarmforge/operator/ticket-message-map.json`).
  These are the source for the ask's own post time (age source) and for
  building the deep link (topicId/messageId).

## The gap this ticket must add

**No Telegram deep-link URL builder exists anywhere in the codebase today.**
Standard format: `https://t.me/c/<internal_chat_id>/<topic_id>/<message_id>`,
where `internal_chat_id` is the numeric `TELEGRAM_CHAT_ID`
(`extension/src/tools/telegram-front-desk-bot.ts:2674`, `requiredEnv`) with its
`-100` prefix stripped. This ticket needs to add that builder, feed it the
Approvals topic's `topicId` and the specific approval-ask's `messageId` (both
already recorded per ticket — see above), and put the resulting URL in the
email body.

## Staleness convention (follow BL-576's precedent, don't invent a new shape)

- **Threshold:** conf-tunable, same shape as BL-576's `note_actionable_after_ms`
  — a key discoverable as a commented line in `swarmforge/swarmforge.conf`,
  resolved via the **effective config path** (BL-216/BL-313: whatever the pack's
  `swarm-identity` recorded at launch), never the tracked default file directly.
  Suggest `approval_ask_stale_after_ms` or similar, specifier's call on the exact
  name/default.
- **Age source:** the approval-ask's own recorded post time (from
  `blTopicStore`/`ticketMessageMapStore`), **never file mtime** — worktree syncs
  touch files constantly and would give false staleness (same rule BL-576 states
  for its own note-age check).
- **Fail-closed:** if the age source can't be parsed/found, do not guess/send —
  same posture as BL-576.
- **Cooldown:** reuse `NeedsHumanEmailNotifier`'s existing grace+cooldown shape
  so a still-unanswered approval doesn't re-email every tick — send once past
  threshold, then respect a cooldown before re-sending (mirrors BL-073/BL-148).

## Open questions for the specifier to resolve in the spec

- One email per stale ticket, or one digest email if multiple approvals are
  stale at once? (The Approvals topic already bundles all asks into one topic —
  a digest may be the more natural fit, but specifier's call.)
- Does an `amending` state count as "answered" (resets the clock) or still
  "unanswered" (human asked for a change but hasn't confirmed)?
- Should the email fire once and then only re-fire after each cooldown window
  while still pending, or fire once and stop until the ticket's approval state
  actually changes?

## Proposed ticket

Specifier: drain this intake into a properly-scoped ticket in `backlog/paused/`
with a Gherkin feature under `specs/features/`. `human_approval` still required
before promotion.
