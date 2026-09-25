# Closing ceremony lean pass - shift 2026-09-25 (specifier)

Packet: `.swarmforge/lean/ceremony/2026-09-25.json`, brought by the
coordinator's note 011473 (07:12Z). Outcome recorded with
`closing-ceremony-outcome.js --shift 2026-09-25 --outcome no_change`.

## Packet, read

Window: the swarm was down overnight and relaunched by hand at 06:46Z,
so the packet covers about 26 minutes (06:46Z-07:12Z). Path coder ->
architect -> QA -> cleaner -> hardender -> documenter. No bounces, no
skip reasons.

1. **"Longest dwell: QA (833260ms)"**: 14 minutes in total, QA holding
   BL-1726 (three chases 06:46Z-06:56Z while it ran lanes). Over a
   26-minute window that is one parcel's gate, not a throughput
   hotspot. No ticket.
2. **"5 chase(s) in coder this shift"**: the chased items were
   coordinator notes queued while the swarm was down. `011432`
   (branch-behind merge-up) and `011433` (Work BL-1725) were chased at
   counts 1 to 5 between 06:46Z and 07:06Z. `011420` (Work BL-1724) was
   chased once at 06:46Z, before the coder dequeued it. The one nudge,
   at 07:01Z, was on `011420` while the coder was working it. The coder
   completed QA's BL-1723 merge-up at 06:47:05Z and BL-1717's merge-only
   copy at 06:47:21Z, then worked Work BL-1724 until 07:10:36Z, with the
   other two notes waiting behind it. `chase_sweep_lib.bb`'s
   `decide-item-action` chases a stale inbox item with backoff while the
   role shows recent activity (BL-1652: busy only gates the at-ceiling
   branch). So these chases are the designed ladder, not a stall. The
   coder was never respawned. No ticket.
   - Observed, not ticketed: the ledger attributes all five coder chases
     to **BL-1717**, which the coder only held as queued merge-only
     copies. `leanLedgerComposeStall.ts` opens a ticket's window at the
     handoff's `enqueued_at`, not its `dequeued_at`, and task-less
     `Work BL-NNNN` notes open no window. So a chase lands on whichever
     task-bearing handoff was sitting in the queue. The role-level count
     the packet reports is right. The per-ticket stall history is not,
     and a chase with no queued task-bearing handoff under it would be
     dropped from the packet entirely. Fixing it is a design choice
     BL-819/BL-918 made deliberately ("handoffId is a mailbox filename,
     not a stable ticket reference"): open the window at `dequeued_at`,
     or attribute a chase to the chased file's own ticket. If a later
     packet's hypothesis is misled by this, mint it with that choice as
     a `ruling_options` ask.
3. Quality recommendations (raise architect/coder/documenter/QA, lower
   cleaner/hardender) are the coordinator's dials. Nothing on the spec
   side.
4. Determinism candidates: `pass-bounce-evidence` 0.0384 and
   `backlog-promotion` 0.2172, the same two classes offered on every
   pass since 09-06. The 09-20..09-24 passes reasoned them: the
   subjects carry ticket ids by design, and the promotion subject is
   already scripted. No open ticket declares either `ritual_class`, so
   expect both offered again.

## Also landed this pass (not from the packet)

BL-1732 amendment: the human's "any rule that should always hold?" field,
drafted by the operator session at 07:59Z and left uncommitted when the
swarm relaunched. Verified, scenario 08 tightened, landed under its own
subject.

## Shift-end consolidation sweep (BL-680)

Scope: tickets minted since the 2026-09-24 pass (09:15 local), BL-1715..
BL-1739. Done since: BL-1716, 1718-1721, 1723. Active (bound: never
consolidated): BL-1717, 1724-1728. Paused: BL-1715, 1722, 1729-1739.

- BL-1715 vs BL-1698: BL-1715 branches BL-1698's escalate/release path
  for a stage that also has a Claude seat, and `depends_on` it. Sliced at
  mint, not overlapping.
- BL-1738 vs BL-1728: same root cause (BL-1517's git-checkout refusal of
  bare mkdtemp fixture roots), different files. BL-1728 is active, so it
  is out of bounds. BL-1738 already excludes BL-906 and the watchdog
  shell test by name (its lines 17-18, 93, 135).
- BL-1738 vs BL-1739: BL-611's three reds have causes other than
  BL-1517. Split at mint.
- BL-1729 vs BL-1730: root cause (tree walk reads `.swarmforge/`) vs
  diagnosis (heap death names its file). The human approved BL-1730
  separately.
- BL-1731..BL-1737: one epic, a single `depends_on` chain, split by
  INVEST at mint.
- BL-1722: hotfix-ledger snapshot; nothing else in the window touches it.

No merge.

By specifier.
