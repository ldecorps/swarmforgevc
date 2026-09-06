# Host-agent activity feed (BL-833)

The host Cursor agent already turns SDK events into human-readable progress
lines (`summarizeSdkProgressLine` / throttled reporters) and Telegram already
receives them. Nothing persisted those lines for a second consumer. BL-833
tees the same lines into a bounded per-session feed the bridge serves so a
client other than Telegram (Bubble screen is BL-834) can watch a turn.

## Behaviour

1. **Tee, do not re-route.** `telegramCursorBridgeLive.ts` still drives the
   Telegram throttled reporter. Alongside it, `recordHostActivity` /
   `recordHostActivityLine` appends to `hostActivityFeed.ts`. Session
   begin/end wrap the live prompt turn.
2. **Bounded buffer (128).** Oldest lines evict first. A long session cannot
   grow the store without limit.
3. **Emit-only.** The feed holds only lines the host actually emitted — no
   synthesized steps, inferred progress, or reconstructed transcript.
4. **Two reads, one source.** Authenticated `GET /host-activity` returns the
   current buffer (or `{ status: "quiet" }` when no session). New lines push
   as `event: host-activity` on the existing authenticated `/events` SSE
   stream. Catch-up and live push share the same buffer.
5. **Observing never damages the turn.** Feed write failures are swallowed;
   the host turn and reply always proceed.

No new redaction pass: every line is already sent to the operator Telegram
topic under the same bridge auth principal.

## Operator / client check

With the bridge running and an authenticated client:

- `GET /host-activity` while a turn runs → `status: active` + lines
- Same path with no session → `status: quiet` (not a fault)
- Attach `/events` → receive `host-activity` events as lines arrive

Acceptance: `specs/features/BL-833-host-agent-activity-feed.feature`

## Related

- Host operator commands: `docs/how-to/BL-698-telegram-cursor-operator-commands.md`
- Screen that renders this feed: BL-834 (out of scope here)
