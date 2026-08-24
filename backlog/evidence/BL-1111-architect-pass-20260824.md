# BL-1111 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner `a2e90ccbef` (on coder `b198adb2e` / yaml tip
`68d828ce6e`) into `swarmforge-architect`. Merged cleanly; ancestry
confirmed.

## Scope

Recover front-desk reply-relay from undici `terminated` / `fetch failed`
before the BL-621 sustained-outage window is burned:

- Pure core: transport-error markers, 5s reconnect backoff cap,
  `isReplyRelayHealthy`, `assertReplyRelayEventsResponse`,
  `computeReplyRelayCycleResult` carries `lastError` / transport backoff.
- Live wiring: reject empty/non-OK `/events`, `reader.cancel()` on exit,
  pass errorMessage into the cycle result.
- APS + unit + property coverage for the three scenarios.

Does not re-spec the sustained alert (BL-621 intact: once-per-episode,
names last error).

## Architecture

- Thin live loop; policy in pure core (same poll/relay split as BL-320/621).
- Transport vs ordinary errors share one reconnect path with a capped max —
  matches approval "one reconnect path" call.
- Empty-body success was a real false recovery; assert forces backoff.
- SSE cancel addresses half-open undici "terminated" signature.
- No webview storage; host-side Telegram bot only. No SwarmForge fork.
- Stamp-off tip hygiene: HOTFIX_PATHS match `27273f2b0a`; BL-1113 9/9;
  Spec/`&nbsp;` OK.

## Required hard gate

Parcel core + property test:

    node extension/out/tools/dependency-gate.js \
      src/tools/telegramFrontDeskBotCore.ts \
      test/bl1111ReplyRelayTerminatedOutage.property.test.js
    → PASSED.

Scanning `telegram-front-desk-bot.ts` surfaces the standing
`telegram-front-desk-bot` ↔ `telegramCursorOperator{Exec,Liveness}` cycle —
already ticketed **BL-759** (`backlog/paused/…`). This parcel does not add
or rearrange that cycle; out-of-parcel standing debt, not a bounce.

## Co-change

Core ↔ live bot ↔ core tests: expected coupling. Advisory only.

## Invariants review (BL-633/BL-654) — 2 declared, both encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Recoverable relay recovers before sustained threshold | property (transport delay ≤ 5s) + feature 01 | Green |
| 2 | Sustained terminated → exactly one alert naming last error | property + feature 02 | Green |

Non-vacuity: ordinary errors keep full 60s backoff max (property 3). Scenario
03 (`isReplyRelayHealthy` rejects sticky `fetch failed`) is the health
predicate for callers; live cycle keeps failures in step via the same
result map.

## Property-testing support (undeclared)

Declared pair + non-vacuity covered. No additional undeclared property
authored.

## Correctness read-through

- Unit BL-1111 5/5; properties 3/3; acceptance 3/3; stamp-off 9/9.
- Success path omits `lastError` (clears sticky transport fault).
- No prior BL-1111 bounce evidence.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1111-reply-relay-terminated-sustained-outage`, commit = this evidence
commit (BL-536 / BL-806).

By architect.
