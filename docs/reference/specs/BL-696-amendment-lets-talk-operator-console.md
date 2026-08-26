# BL-696 Amendment: Let's Talk operator console (post-ship)

**Status:** implemented (operator phone testing, 2026-07-29)  
**Parent:** [BL-696 how-to](../../how-to/BL-696-miniapp-lets-talk-cursor-audio.md) · [local hybrid audio](BL-696-amendment-local-hybrid-audio.md) · [operator commands](BL-696-amendment-telegram-operator-commands.md)

---

## Context

After BL-696 closed (discrete audio turns + local hybrid audio + hands-free), live
phone use exposed gaps that are not a second ticket yet: home-screen install
dropped auth, long thinking turns were silent, the screen slept mid-turn, and
Cursor Remote could not see audio-turn replies. This amendment records what
landed on the Let's Talk page and its supporting bridge/operator paths.

Discrete turn-taking remains the model. Hands-free (BL-697) stays optional.

---

## Screen controls (user-visible)

| Control / indicator | Behavior |
|---------------------|----------|
| **Record** / **Listening** | Tap-to-toggle record; hands-free auto-starts after speech/error delays |
| **Hands-free** | Auto-listen after reply; silence stops the turn (unchanged BL-697) |
| **Mute voice playback** | Skip `speechSynthesis`; transcript still shown. Persisted in `localStorage` |
| **Keep screen awake** | Screen Wake Lock API while enabled (default on). Badge shows active/inactive/unsupported |
| **Hold music** | Web Audio chiptune during `thinking` (default on, gain ≈ 0.015). Title shown while playing |
| **Pause all** | Stops record/playback/hold music, forces mute, disables hands-free until Resume |
| **Install app** | PWA install prompt when the browser offers it; badge shows install state |
| **New session** | Clears shared Cursor `agentId` (same as `/new`) |
| **Bridge health** badge | Polls bridge reachability; page background tints green / amber / red |
| **Wake lock** badge | Live wake-lock state |

Conversation phases remain `ready` → `thinking` → `speaking` → `ready` (or recoverable `error`).

---

## Auth and PWA install

Telegram WebView storage does **not** carry over to an installed Chrome PWA.

1. Bearer from `?bearer=` / `?token=` is saved to `localStorage` (`lets-talk-bearer`) **and** a `Path=/; SameSite=Lax` cookie (long Max-Age).
2. Reloads without a query string restore the token from storage/cookie and rewrite the URL via `history.replaceState` when possible.
3. `/lets-talk/manifest.json?bearer=…` bakes the bearer into `start_url` so the home-screen icon launches already signed in. Cache-Control is `no-store`.
4. Minimal `/lets-talk/sw.js` registers under scope `/lets-talk` (install/activate only; no offline shell).

**Operator tip:** open once from a console/Telegram link that includes the bearer, then use **Install app**. Bare `/lets-talk` without a stored token still reaches the shell (healthy bridge badge) but turns return 401.

---

## Cursor Remote mirroring

On each successful Let's Talk turn, the bridge best-effort mirrors `replyText` to the
Cursor Remote Telegram topic (`onTurnSuccess`). Numbered choice lists (2–10 options)
are also posted as a Telegram poll and recorded in
`cursor-bridge-state.json` → `pendingChoicePolls`. Poll answers become follow-up
prompts to the same agent. Mirror failures never fail the Mini App turn.

---

## Operator / bridge support

| Surface | Behavior |
|---------|----------|
| `/redeploy miniapp` | Compile extension and bounce the headless Mini App bridge (`bounce_bridge_headless.sh`) |
| Operator miniapp watchdog | Tick probes `GET /lets-talk`; after N consecutive failures, bounce with cooldown (`OPERATOR_MINIAPP_*` env) |
| Cursor quota | `resource_exhausted` / rate-limit surfaces a clear recoverable message; session is not reset |

---

## Implementation map

| Concern | Module |
|---------|--------|
| UI shell + client logic | `extension/src/bridge/letsTalkUiHtml.ts` |
| Turn route + `onTurnSuccess` | `extension/src/bridge/letsTalkRoutes.ts` |
| Manifest / SW / mirror wiring | `extension/src/bridge/bridgeServer.ts` |
| Quota wording | `extension/src/bridge/cursorBridgeAgentSession.ts` |
| Choice polls + `/redeploy miniapp` | `telegramCursorBridgeCore.ts` / `Live.ts` / `MiniAppRedeploy.ts` |
| Mini App health bounce | `swarmforge/scripts/operator_runtime.bb` |

---

## Tests

- `extension/test/letsTalkBridge.test.js` — shell controls, PWA manifest/SW, `onTurnSuccess`
- `extension/test/telegramCursorBridge*.test.js` — redeploy parse, choice/queue polls
- `swarmforge/scripts/test/test_operator_runtime_tick.sh` — miniapp-watchdog bounce cycle

---

## Non-goals (still)

- Live duplex / barge-in / streaming STT
- Background or lock-screen audio when the OS suspends the WebView
- Replacing Cursor Remote or Concierge text topics
- Offline-capable PWA (service worker does not cache the shell)
