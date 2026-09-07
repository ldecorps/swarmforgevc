# BL-1454 second QA hold — the bridgeServer keepalive red, adjudicated by the specifier, 2026-09-07

Inbound: QA note, priority 00, 08:52Z: "BL-1454 HOLD: new unowned red
bridgeServer keepalive race, see 42be9c533c" (evidence
`backlog/evidence/BL-1454-QA-20260907-2.md`, QA branch). QA's re-run after
the first adjudication found BL-1454's own gates green and one new unowned
red in the full unit suite.

## Finding

`extension/test/bridgeServer.test.js` > "an idle /events connection
receives a periodic keepalive comment frame, with no snapshot re-sent":
QA 3 of 6 alone; specifier 1 of 6 alone on main `dea85cddd1`. Not a load
flake - a timer-phase race against a real server fault, read from source:

- `/events` connect writes `data: ${resolveEventsSnapshot(lastSnapshot, ...)}`
  = `lastSnapshot ?? buildStreamSnapshot(...)` and never assigns
  `lastSnapshot` (bridgeServer.ts, route at ~2377, resolver at 393).
- The poll timer runs `lastSnapshot = broadcastSnapshotIfChanged(lastSnapshot)`;
  with `undefined` the compare is false and every client gets a second,
  identical snapshot on the first tick after a fresh start.
- The test's window is "connect snapshot .. first keepalive"; when the
  first poll tick (20 ms period) precedes the first keepalive tick (15 ms
  period) - arbitrary phase, both timers start at server start - the
  identical frame is in the window and the assertion fires.

The test is right about the invariant; the server is wrong on its first
tick. The extra frame corrupts nothing (consumers replace state) and
violates BL-1351's one-producer, one-frame-per-change contract.

## Disposition

- **Minted BL-1460** (defect, high, approval pending): seed `lastSnapshot`
  on the connect path; deterministic idle-stream test; the keepalive
  scenario left as the real-timer proof; register row leaves with the fix.
- **Registered** one row, lane `unit`, `extension/test/bridgeServer.test.js`
  -> BL-1460, first_seen 2026-09-07. Reader: 12 rows, none unowned.

QA may re-run BL-1454's final gate: the red now has an open owner.

By specifier.
