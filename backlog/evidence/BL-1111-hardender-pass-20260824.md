# BL-1111 — hardener pass, 2026-08-24

## Inbound

Merged architect `ad78c76a2a` (on cleaner `a2e90ccbef` / coder
`b198adb2e`) into `swarmforge-hardender`.

## Scope

Transport-aware reply-relay reconnect: marker table, 5s backoff cap,
`isReplyRelayHealthy`, `assertReplyRelayEventsResponse`, cycle result
`lastError` / transport backoff; live `/events` reject + SSE `cancel()`.
Touches `telegramFrontDeskBotCore.ts` + `telegram-front-desk-bot.ts`.

## Host / BL-149

Both changed `src` files: **skip-cooldown** (age ~1.36d < 3d). Host quiet
(~2.7 load / 20 cores). No Stryker this pass — targeted tests + surgical.
Full mutation deferred to a quiet later pass if needed.

Standing dep-cycle `telegram-front-desk-bot` ↔ cursor-operator (BL-759)
unchanged; architect-required gate on core + property **PASSED**.

## CRAP (differential, after full core unit coverage)

| Function | complexity | coverage | CRAP |
|---|---|---|---|
| `assertReplyRelayEventsResponse` | 3 | 100% | **3.00** |
| `isReplyRelayTransportError` | 2 | 100% | **2.00** |
| `replyRelayReconnectBackoffMs` | 2 | 100% | **2.00** |
| `isReplyRelayHealthy` | 2 | 100% | **2.00** |
| `computeReplyRelayCycleResult` | 2 | 100% | **2.00** |

Pre-existing CRAP>6 elsewhere in the file is grandfathered; parcel does not
touch those functions.

## BL-113 Gherkin

`outcome: "inapplicable"` (plain Scenarios). Fell back to surgical (BL-638).

## Hand-authored surgical

| # | Mutant | Result |
|---|---|---|
| M1 | Drop `terminated` marker | killed |
| M2 | Drop `fetch failed` marker | killed |
| M3 | Cap 5s → 60s | killed |
| M4 | Healthy ignores `lastError` | killed |
| M5 | Skip empty-body assert | killed |
| M6 | Success path keeps sticky `lastError` | killed |

Survivors: 0.

## Verification

- Unit BL-1111 5/5; full core suite 427/427
- Acceptance 3/3; properties 3/3
- Standing whole-tree guards 13/13 (125 tests)
- HOTFIX pack + board match `27273f2b0a`

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1111-reply-relay-terminated-sustained-outage`.

By hardender.
