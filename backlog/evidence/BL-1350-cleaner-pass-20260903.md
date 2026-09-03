# BL-1350 — cleaner pass, clean sweep (NONE)

Ticket: BL-1350-idle-event-stream-keepalive
Role: cleaner
Inbound commit: f65f7d8f2d (coder)
Merge commit: 2df369ad20

## Checklist run

- Coverage: coder's suite includes a dedicated property test
  (`test/bl1350KeepaliveInvariants.property.test.js`, 3/3 pass) plus
  acceptance steps for both declared invariants and all four scenarios.
  `test/bridgeServer.test.js` (99 tests) still passes unmodified.
- CRAP: no new branching of note — `writeSseKeepalive` is a single guarded
  loop (liveness check, write-or-drop) already exercised by the property
  test's structural/behavioural assertions; no uncovered path found.
- DRY (`jscpd` scoped to the two changed files): 3 pre-existing clones
  found, none touching the lines this ticket added (writeSseKeepalive /
  keepalive interval wiring in bridgeServer.ts:2290-2330;
  drainBufferedRecords export in telegramFrontDeskBotCore.ts). Not this
  ticket's to fix.
- Module structure / architecture: `writeSseKeepalive` is defined beside
  `sseClients` and the poll timer in the same module that owns them, per
  the ticket's `required_wiring` anchor — verified live in the diff
  (bridgeServer.ts), not merely present in a helper. `stop()` clears the
  new `keepalive` interval alongside `poll`. Client removal on
  writableEnded/destroyed/throw is present, so a dead socket cannot hang
  the timer or resurrect a removed client.
- Mutation-site count (BL-485): both changed files report `over` threshold
  (bridgeServer.ts 1839 sites, telegramFrontDeskBotCore.ts 1968 sites) but
  both are pre-existing god-modules — this ticket added 52 and 8 lines
  respectively. A split is out of scope for this parcel: neither addition
  introduces new structural coupling that a split would fix, and a
  mechanical chop of either file to duck the count would be scope creep
  well beyond BL-1350 (BL-506 — an approval authorizes only its own
  ticket's work). Left whole; noted here as an advisory, not actioned.
- `npm run compile` (tsc) clean.

## Verdict

No defect found. No cleaner-authored change needed — forwarding f65f7d8f2d
merged as 2df369ad20 unchanged, per Article 4.4's NONE-evidence path.

By cleaner.
