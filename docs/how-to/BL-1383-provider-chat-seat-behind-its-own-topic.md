# A direct-provider chat seat behind its own Telegram topic (BL-1383)

## What it is

A Telegram forum topic bound in `.swarmforge/operator/provider-chat-topic-map.json`
(gitignored, host-only) answers directly from a remote OpenAI-compatible
chat provider — DeepSeek, NVIDIA NIM, the GLM seat on the b.ai gateway, etc.
(never OpenRouter). Before this, no code on `main` read that map, so any
message in such a topic fell through to the front desk's generic path and
opened a support subject instead of an answer. Generalizes
[BL-1235's local Qwen seat](BL-1235-local-qwen-seat-behind-its-own-topic.md)
from a single local model to any number of remote, directly-configured
providers; BL-1384 covers the sibling reachability gap on the qwen-local
seat specifically, flagged by the same intake (see
[BL-1235's how-to](BL-1235-local-qwen-seat-behind-its-own-topic.md#reachability-in-production-the-front-desk-must-forward-the-topic-too-bl-1384)).

## Where it lives

Pure decision (`extension/src/tools/providerChatSeat.ts`,
`decideProviderChatTurn`): given a topic id, the map, and the process env,
returns `not-mine | refuse | answer` — no I/O, no network. Live I/O
(`providerChatSeatLive.ts`, `runProviderChatSeatTurn`): reads the map,
posts the acknowledgement, calls the provider's chat-completions endpoint,
posts the reply or the provider's own failure reason. Wired into the live
poller's dispatch in `telegramFrontDeskBotCore.ts`'s `processMessageUpdate`
— checked immediately after the cursor-bridge topic exclusion and before
the side-channel/generic-subject path, so a bound topic's message is
decided before any support subject could ever open for it. The live
adapter (`telegram-front-desk-bot.ts`) supplies `runProviderChatSeat`,
posting via the same `sendTelegramMessage` every other reply in that file
uses. Core only decides whether to call the adapter and to stop there; the
live side performs — the same split `forwardCursorBridgeUpdate` already
uses for the cursor-bridge exclusion.

## The map's shape

```json
{
  "<message_thread_id>": {
    "model": "<model-id>",
    "baseUrl": "https://api.deepseek.com",
    "apiKeyEnv": "DEEPSEEK_API_KEY",
    "systemPrompt": "<optional static orientation text>"
  }
}
```

A seat is only `answer`-eligible once `model`, `baseUrl`, and `apiKeyEnv`
are all non-empty AND the environment variable `apiKeyEnv` names is
actually set in the front-desk process's own environment — never read from
the map, the target working directory, or a commit (invariant 2). An
incomplete seat, or one whose env var is unset, refuses with the specific
reason rather than falling through to the generic path.

## The seat's own live grounding, not the model's

`composeSwarmContextBlock` (`providerChatSeatLive.ts`) appends a short,
plain-fs-read snapshot (launch pack, active backlog depth cap, active/paused
ticket counts) to the seat's static `systemPrompt` before every request —
composed server-side and never throwing (a failed read degrades to fewer
facts, not a broken reply). This is a lighter parity with the Cursor host
topic's real tool-using session, not an attempt to replicate it: a plain
chat-completions call has no tools of its own to reach for.

## Refusal is never silent, never a bare status

A provider call that throws, times out, or returns a non-OK HTTP status
becomes a refusal posted in the same topic naming the provider's own error
text (never a bare status code — BL-572/BL-662); an empty completion is
also refused rather than posted as a blank message. A `not-mine` decision
(the topic isn't bound) posts nothing at all and falls through to the
front desk's ordinary path unchanged.

## Scoped out of this ticket

The human's original patch also touched `telegramCursorBridgeLive.ts` to
add a provider-seat hook there; that hunk was deliberately dropped at mint
— the cursor-bridge process only ever receives updates the front desk
forwards for the cursor and Bubble topics, so a hook there is code no live
path reaches (the same unreachable-wiring shape BL-1235's precedent
guards against). A second transport, if ever wanted, is its own slice.
Also out of scope: any change to the map's own shape, and rate
limiting/streaming/conversation memory for a seat.

## Verifying

1. Unit/acceptance over a fake provider endpoint: a bound topic answers,
   an unbound topic follows the front desk's normal flow unchanged, a
   failing provider reports its own reason in the topic, and a cursor-host
   topic is never claimed by this seat.
2. Live, with a real seat configured in the map and its API key set in the
   environment: redeploy the front desk, post in the bound topic, and
   confirm an acknowledgement then the model's reply arrive there, with no
   support-subject icon ever appearing on that topic.
3. Post in an unbound topic and confirm the front desk behaves exactly as
   before (a subject opens).

## See also

- [BL-1235: local Qwen seat behind its own topic](BL-1235-local-qwen-seat-behind-its-own-topic.md)
  — the pattern this generalizes, including the "never fall through to a
  support subject" posture and the never-a-bare-status refusal shape.
- BL-1384 — the sibling qwen-local-seat reachability gap flagged by the
  same intake; documented in BL-1235's how-to (linked above), since it is
  the feeder-side half of that seat's own contract, not a new mechanism.

Acceptance: `specs/features/BL-1383-a-topic-bound-to-a-chat-provider-answers-there.feature`.
