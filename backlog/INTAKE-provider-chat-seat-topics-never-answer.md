# INTAKE — Provider-chat-seat Telegram topics are configured but never answer

**Source:** human via Claude Code, 2026-09-04  
**Status:** new intake, not minted  
**Priority:** low — three test seats affected, none load-bearing for the
pipeline; purely a "the feature silently does nothing" gap.

## What's broken

`providerChatSeat.ts` / `providerChatSeatLive.ts` implement "bind a Telegram
forum topic to a direct OpenAI-compatible chat provider" (own docstring:
"Operator test seats"), reading bindings from the gitignored
`.swarmforge/operator/provider-chat-topic-map.json`. The map already has
entries for two seats (`nemotron-3-ultra-free` via opencode.ai,
`deepseek-v4-flash` direct) plus a third the human just added tonight
(`glm-5.3-flash` via the b.ai gateway, topic "GLM (b.ai)", thread id 71550).

**None of the three ever answer.** `runProviderChatSeatTurn` — the function
that actually reads the map, decides whether a topic is bound, and posts a
reply — is exported from `providerChatSeatLive.ts` but is called from
**nowhere** in `extension/src`. A message in any of these topics currently
falls through to the generic front-desk flow, which treats it as a brand-new
support request and opens a subject for it (visible tonight as "SwarmForge
Concierge changed the topic icon to 🎫" instead of an actual reply).

## Root cause, verified live tonight

- The actual running Telegram poller is `telegram-front-desk-bot.ts`
  (launched via `launch_front_desk.sh` →
  `extension/out/tools/telegram-front-desk-bot.js`), whose per-update
  dispatch (`processMessageUpdate` in `telegramFrontDeskBotCore.ts`) has
  adapter hooks for the Cursor Remote / Bubble topics
  (`cursorBridgeTopicId`/`bubbleTopicId`/`forwardCursorBridgeUpdate`) and
  falls through to `openSubjectAndRecord` for anything else — there was no
  hook at all for a provider-chat-seat topic.
- A first attempt wired `runProviderChatSeatTurn` into
  `telegramCursorBridgeLive.ts`'s poll loop instead (same slot as its
  existing `qwenLocalTopicId` seat) — confirmed via `/proc/<pid>` inspection
  and live Telegram testing that this genuinely is a **separate**,
  separately-supervised process (`cursor_bridge_supervisor.bb` →
  `telegram-cursor-bridge.js`), and that `telegram-front-desk-bot.ts` only
  forwards updates into that process's queue for the Cursor/Bubble topics —
  never for `qwenLocalTopicId` or any provider-chat-seat topic. So that
  wiring alone never fires for these topics (and, as a byproduct, this
  intake questions whether `qwenLocalTopicId`/"Local Qwen" is reachable in
  production at all right now, for the identical reason — out of scope
  here, flagged for whoever picks this up).

## Already-drafted fix (patch attached, not applied to main)

`backlog/evidence/INTAKE-provider-chat-seat-wiring-hotfix.patch` — built and
manually verified tonight (compiled clean with `tsc`, redeployed via
`redeploy_front_desk.sh`, exercised live through the real GLM (b.ai) topic:
acknowledgement → live model reply, confirmed in Telegram). Refused by
`check_pipeline_code_on_main.sh` when committed directly (correctly —
`extension/src/` is pipeline code, Article 1.8/4.2/BL-247, no operator hotfix
exception exists for it), hence this intake instead of a direct commit.

Touches:
- `extension/src/tools/providerChatSeat.ts` (new) — adds optional
  `systemPrompt` to `ProviderChatSeatConfig` and threads it through
  `decideProviderChatTurn`'s `'answer'` outcome.
- `extension/src/tools/providerChatSeatLive.ts` (new) — adds
  `composeSwarmContextBlock` (cheap, never-throws fs reads: swarm-identity
  pack/rotation, active/paused backlog counts) appended to any configured
  `systemPrompt` on every turn, and threads `systemPrompt` through
  `completeWithProviderChat`'s request body as a `system` message.
- `extension/src/tools/telegramFrontDeskBotCore.ts` — new
  `runProviderChatSeat?` adapter on `PollAdapters`, new
  `attemptProviderChatSeatDelivery`, called in `processMessageUpdate` right
  after the existing Cursor-bridge exclusion check and before
  `decideUpdateAction`/`openSubjectAndRecord`.
- `extension/src/tools/telegram-front-desk-bot.ts` — the live adapter:
  calls `runProviderChatSeatTurn` with a `post` that reuses
  `sendTelegramMessage` exactly as every other reply in this file does.
- `extension/src/tools/telegramCursorBridgeLive.ts` — the qwenLocal-mirrored
  wiring from the first (insufficient alone) attempt, left in since it's a
  real, live-running process and harmless/consistent even though nothing
  currently routes a provider-chat topic to it.

The patch is a straightforward apply (`git apply
backlog/evidence/INTAKE-provider-chat-seat-wiring-hotfix.patch` from repo
root) — whoever picks this up should review it fresh rather than trust it
uncritically, but it is not a from-scratch design task.

## Specifier notes

- No `required_wiring` proposed here — the anchor is straightforward
  (`runProviderChatSeat` string in `telegramFrontDeskBotCore.ts` /
  `telegram-front-desk-bot.ts`), leaving the exact required_wiring shape to
  mint time.
- Consider whether to fold in a look at `qwenLocalTopicId` reachability
  (flagged above) as a sibling ticket or explicitly out of scope — it is the
  same defect class but a separate topic/seat, not touched by tonight's fix.
- `.swarmforge/operator/provider-chat-topic-map.json` and the `B_AI_API_KEY`
  env var are already live/configured (gitignored runtime state + shell
  profile, not part of this patch) — nothing further needed there for QA to
  exercise the GLM seat specifically, though a fixture-based acceptance
  test should not depend on real network/API keys.
