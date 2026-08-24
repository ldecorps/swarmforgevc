# BL-1111 cleaner pass — 2026-08-24

## Inbound

Handoff cited `68d828ce6e` (yaml paused→active rename only; no functional
change). Absorbed child tip `b198adb2e` (real reconnect/health fix) via
`git merge --no-ff` after the cited tip. Ancestry:
`git merge-base --is-ancestor b198adb2e HEAD`.

## Checks run

1. **Unit** — `npx vitest run test/telegramFrontDeskBotCore.test.js -t 'BL-1111'`:
   5/5 pass.
2. **Property** —
   `npx vitest run --config vitest.properties.config.mjs test/bl1111ReplyRelayTerminatedOutage.property.test.js`:
   3/3 pass.
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1111-reply-relay-terminated-sustained-outage.feature`:
   3/3 pass.

## Cleanup performed

- `isReplyRelayTransportError`: single marker table (`some`) instead of
  duplicated `includes` ORs.
- `assertReplyRelayEventsResponse`: TypeScript `asserts` predicate so
  `connectAndRelayReplies` drops `res.body!`.
- Documented that the success branch of `computeReplyRelayCycleResult`
  omits `lastError` (clears sticky transport faults).

## Findings beyond that

NONE. Transport-capped backoff (5s), `/events` must be OK+body, SSE reader
`cancel()` on exit, and once-per-episode sustained escalation are intact.
Mutation-site counts on the two live wrappers remain over the 100 threshold
(pre-existing file size); BL-1111 helpers stay extracted pure functions.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1111-reply-relay-terminated-sustained-outage`.

By cleaner.
