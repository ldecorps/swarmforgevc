# BL-281 QA bounce — 2026-07-11

## 1. Failing command

```
git merge-base --is-ancestor 51819cd e07cb1abcf
```

Exits 1 (false) — the delivered documenter commit does not contain the
specifier's architecture reshape at all.

## 2. Commit hash

`e07cb1abcf` (documenter's handoff, merged into QA at the current QA-branch
HEAD).

## 3. First error excerpt

The specifier committed `51819cd` ("Reshape BL-281 Talk MVP to bridge-client
arch; update BL-274 epic topology") directly to `main`, rewriting
`backlog/active/BL-281-operator-telegram-topic-threads.yaml` and
`specs/features/BL-281-operator-telegram-topic-threads.feature` in place
(same ticket id, same file paths — not a new ticket). Per that commit:

> Per human decision 2026-07-11: a REST bridge sits between Telegram and the
> Operator runtime. Telegram becomes a thin Front Desk Bot that is a CLIENT
> of the existing bridge (BL-065), not coupled directly to the runtime.

The delivered implementation instead:
- Adds `extension/src/tools/telegram-bridge.ts`, a thin Node CLI shelled out
  to directly from `operator_runtime.bb` (create-topic / send / get-updates)
  — a Babashka-to-Node interop shim, not a REST route.
- Leaves `extension/src/bridge/bridgeServer.ts` completely untouched (`git
  diff main..HEAD -- extension/src/bridge/bridgeServer.ts` is empty) — no
  new inbound-message POST route, no SSE reply egress.
- `operator_runtime.bb` itself still long-polls Telegram `getUpdates`
  directly and calls `sendMessage` directly — the exact direct
  runtime↔Telegram coupling the reshape explicitly rules out ("The runtime
  NEVER calls Telegram and the bot NEVER calls the runtime directly — every
  hop is mediated by the bridge").

## 4. Failure class

`behavior` — not a compile, unit, integration, or acceptance failure. The
full unit suite (211 files / 2849 tests) and all 5 of the delivered feature
file's own scenarios pass. The gap is invisible to both because the
delivered feature file is the STALE pre-reshape version — it was never
regenerated against the new architecture the ticket now specifies on `main`.

## 5. Expected vs observed

**Expected (current, authoritative `backlog/active/BL-281-...yaml` +
`specs/features/BL-281-...feature` on `main`, reshaped by the specifier on
2026-07-11 at `51819cd`):** Telegram is a thin Front Desk Bot (bridge
client) that POSTs inbound messages to a new authed `bridgeServer.ts` route
(mirroring `POST /gate-answer`); the bridge enqueues a per-SUP-### event;
the Operator runtime consumes it and routes replies out over the bridge's
existing SSE egress back to the bot, which posts into the topic. Async
ingestion, never synchronous RPC; the runtime never touches Telegram
directly.

**Observed:** the delivered code (`e07cb1abcf` and its whole ancestor
chain — confirmed via `git merge-base --is-ancestor 51819cd
e07cb1abcf` failing) was built entirely before the reshape landed. It
implements the ORIGINAL, now-superseded direct-poll design: the Operator
runtime itself calls Telegram's `getUpdates`/`sendMessage` (via the
`telegram-bridge.js` CLI shim), with no REST bridge route, no SSE egress,
and no bot/runtime decoupling. This does not satisfy the ticket's current,
human-decided intent, even though every test for the STALE spec passes.

The coder needs to re-read `backlog/active/BL-281-operator-telegram-topic-threads.yaml`
and `specs/features/BL-281-operator-telegram-topic-threads.feature` fresh
from `main` (post-`51819cd`) and rebuild against the REST-bridge-client
architecture described there.
