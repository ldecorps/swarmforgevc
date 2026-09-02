# Coordinator — front-desk reply-relay "terminated": chronic, not a new outage

Date: 2026-09-02 ~22:43Z. Alert (BL-1111 sustained-outage escalation, the only
alert for this window): "the reply-relay loop has been failing continuously for
35m. Last error: terminated. It keeps retrying on a capped backoff."

## What was checked

- Telegram reachable (`https://api.telegram.org/` 302 in 0.04s).
- Bridge alive and answering: `/` 200, `/health` 200, `/events` 401 without
  token, 200 with the bot's own `BRIDGE_TOKEN`.
- Bot + supervisor: restarted 22:40Z (my build-freshness sync) and again
  22:44Z (supervisor `build-stale ... restarting a HEALTHY process`). Neither
  restart changed the symptom.
- `.swarmforge/operator/front-desk-supervisor.log`: 43 lines of
  `reply-relay degraded - 5 consecutive reconnect failures, still retrying:
  terminated`, first at **2026-08-27T11:44Z**, then roughly every 2-4h since
  (08-31 05:27, 08:16, 10:20, 15:10, 18:50; 09-01 04:59, 08:19, 12:09, 14:48,
  16:59, 18:59; 09-02 11:02, 13:12, 21:38). There is NO "recovered" line —
  the only relay message the log has ever carried is "degraded".
- No ticket in paused/active/hold mentions bodyTimeout, SSE keepalive, or
  idle-terminated. BL-1111 (done) shipped the alert and explicitly did not
  diagnose the cause ("Identify why reconnect stayed on terminated" was left
  as direction).

## Mechanism (evidence, not inference)

1. `extension/out/bridge/bridgeServer.js:1838` `/events` handler: writes ONE
   `data:` frame (the full bridge-state snapshot) at connect, adds the client
   to `sseClients`, then writes only when the snapshot CHANGES or a reply
   outbox entry appears (`setInterval` poll). **No SSE comment/ping keepalive
   is ever written.** A quiet swarm = a silent socket.
2. `extension/out/tools/telegram-front-desk-bot.js:2340` consumer:
   `fetch(`${bridgeUrl}/events`)` with default options — no `bodyTimeout`,
   no dispatcher/Agent override anywhere in bot or core (grepped).
3. Node **v22.22.3**'s bundled undici applies the default `bodyTimeout` of
   **300 000 ms between body chunks**; when it fires inside `fetch`, the
   reader throws `TypeError: terminated` (cause: BodyTimeoutError). That is
   the literal error text the relay reports.
4. Therefore every relay connection dies after 5 idle minutes; the relay
   counts it as a reconnect FAILURE (not a clean close), backs off
   (2s→60s cap), and 5 in a row = "degraded". 5 × ~5 min + backoff ≈ the
   35-minute sustained window in the alert. Matches the cadence: degraded
   lines cluster in quiet hours.
5. Aggravator: the connect-time snapshot is **6.7 MB** (measured:
   `bytes=6764293` in a single `data:` frame) — it embeds the ENTIRE backlog
   (1259 distinct `BL-` ids with `description`, `notes`, `acceptance` bodies).
   `broadcastSnapshotIfChanged` re-sends that whole frame to every SSE client
   on ANY backlog change, so each 5-minute reconnect costs 6.7 MB plus one
   more on every commit that touches `backlog/`.

## Hold test

An authenticated `curl -N --max-time 340` against `/events` (no client body
timeout), started 22:44:48Z:

    http=200 t=340.001533s bytes=6764293
    rc=28   (curl's OWN --max-time; the server never closed)

The socket stayed open the full 340 s — past the 300 s at which the bot's
fetch dies — and received exactly the 6.7 MB connect snapshot and nothing
else. **The bridge does not close idle SSE connections; the client-side
undici bodyTimeout is the sole cause of `terminated`.** CONFIRMED.

## Not a coordinator fix

Domain work (bridge SSE keepalive and/or fetch bodyTimeout override; snapshot
size is a second, separable defect). Routed to the specifier by note.
