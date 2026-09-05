# Closing ceremony 2026-09-05 — specifier lean pass (BL-820)

Packet: `.swarmforge/lean/ceremony/2026-09-05.json`. Outcome recorded:
`process_ticket`, ref **BL-1411**. Also recorded this pass: a BL-990 bounce
attribution correction for BL-1370.

## Hypothesis 2 — one `spec-gap` bounce (BL-1370): caused by amendment timing, not workmanship

- Bounce: BL-1370, by cleaner, commit `12b538c4b9`, 2026-09-05T00:38:45Z,
  charged to **coder** (`.swarmforge/bounces/2026-09.jsonl`).
- Amendment: `3daeaf5b1c` (specifier, 00:01:33Z) reworded invariant 1 and
  added scenarios 07/08. Ticket notes at that commit: "Not a bounce; nothing
  built yet." **No note was sent to the coder** — no file in any role's
  `inbox/` names `3daeaf5b1c` or carries a specifier note for BL-1370.
- Coder's forward: `5243b76535` (00:30:55Z), not built on the amendment
  (`merge-base --is-ancestor` false); its evidence file at that commit has
  no mention of the amendment (grep empty). The amendment section in the
  evidence appears only at `39fe215af1` (00:46:19Z), the post-bounce fix.
- The cleaner's own evidence already reads it this way: "a
  timing/sequencing miss (the amendment landed on `main` while the coder
  was already deep into implementation), not a quality lapse elsewhere."
- Cost: bounce 00:38Z → re-fix 00:46Z → second cleaner pass 01:05Z →
  second architect pass 01:05Z-01:08Z. ~30 min across three roles.
- Same class, same day, other direction: BL-1353 — note sent, but after the
  coder had forwarded; coder and cleaner fixed the same handler on two
  branches (operator memory, 09-05).

**Correction filed** (BL-990): `record-bounce-correction.js --ticket BL-1370
--commit 12b538c4b9 --by specifier`, reason: the specifier's amendment
landed while the coder held the parcel and no holder note was sent.

**Structural remedy minted**: BL-1411 — `swarm_handoff.sh` refuses a
`git_handoff` whose acceptance feature file `main` has amended since the
sender's merge-base. Catches both directions (note never sent, note too
late) at the sender, mechanically, without depending on the note.

## Hypothesis 3 — 9 coder chases, 2 respawns: explained, no new ticket

Chaser telemetry for the shift (`.swarmforge/lean/2026-09-05.jsonl`):
- BL-1370: 2 chases at 01:08Z (coder re-fix after the bounce above).
- BL-1400: 3 chases 01:43Z-01:47Z, inside the 01:36:55Z six-session tmux
  death window (babysitterd repaired).
- BL-1353: 1 chase at 02:08Z — the 02:05:09Z coder-session death.
- BL-1275: 8 chases + 2 respawns 02:54Z-03:30Z on the route note
  `10_20260905T024434Z_004092_from_coordinator_to_coder`. BL-1275 changes
  `check_property_suite_drift.sh`; the property guard runs ~143s under a
  RAM-capped pool (BL-1348/BL-1349) and its load flakes are BL-1407. The
  parcel completed and landed the same shift.

The session deaths (3 events, 01:36Z/02:05Z/03:58Z) are an open operator
watch with cause unconfirmed; `sudo dmesg` from the human is the remaining
diagnostic. Not mintable as an INVEST ticket without a cause — a spike
would have nothing to test. Left with the operator.

## Hypothesis 1 — QA longest dwell (2.38 h): no spec/gate change

QA is the integration point (BL-247) and hand-lands every parcel; BL-1370's
QA processing alone was 40 min, and the 03:58Z QA session death added
4m17s. The packet's `qualityRecommendations` dials are the coordinator's
half of the ceremony, not a specifier change. BL-667 (deterministic transit
assist) already owns the post-QA choreography cost.

## Determinism candidates

None in this packet.
