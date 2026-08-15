# BL-894 — hardener bounce (2026-08-14)

Reviewed commit: `1f727e9db4` (architect, "BL-894: architect pass - approve,
resolve P1 invariant conflict"), on top of coder commit `ee7094645a`
("certify /queue selection-poll repost hotfix, close P2/P3, delete dead
helper") and cleaner commit `961087a6d` ("dedupe queue-poll state sync-back
into shared helper").

## Checklist run (Article 4.4 — complete inventory, one bounce)

- Dead helper (`queuePromptListForDisplay`): **confirmed deleted** — zero
  references in `extension/src/`, `extension/test/`, `specs/`.
- Unit suite (`crap:lets-talk-cursor-bridge` scope, 26 files): **663/663
  green**, including `telegramCursorBridgeLive.test.js` **119/119**.
- Property suite (`telegramCursorBridgeLive.property.test.js`): **4/4
  green**, including the BL-894 invariant-1 property
  ("a vote on a poll this bridge has superseded either changes the queue or
  tells the human it did not") and the invariant-2 property (topic pinning).
- Acceptance (`specs/features/BL-894-queue-reposts-selection-poll.feature`
  via `run_acceptance.sh`): **6/6 scenarios green**.
- CRAP (`npm run crap:lets-talk-cursor-bridge`): **BLOCKED BY** a pre-existing
  coverage-gate failure — `telegramCursorBridgeLive.ts` sits at 80.8%
  (gate requires 90%). Sampled every uncovered line touching or adjacent to
  BL-894's changed region (226-1148 block, 1449-1450, 1564-1565, 1680-1683,
  1789-1790) via `git blame`; all trace to commits dated 2026-07-28 through
  2026-08-08 (`443dffc058`, `84ded08177`, `e54d2129a7`, `f9b38f53d1`,
  `c0f7d4b57a`, `2b8d19d178`) — none touch BL-894's own diff (landed
  2026-08-14). Not a regression this ticket introduced; out of this ticket's
  scope per BL-506 ("An Approval Authorizes Only Its Ticket's Work"). Not
  fixed here, not claimed as passing.
- DRY (`npm run dry`): 2 clones touch `telegramCursorBridgeLive.ts`
  (1098-1105/1124-1131 and 1576-1589/1636-1649). Both blame to
  `7c0cd3a178`/`c0f7d4b57a` (2026-07-29/2026-08-01) — pre-existing, not
  introduced by BL-894.
- Mutation (Stryker): **BLOCKED BY** host load — `uptime` at review time
  showed load averages 14.57/17.19/16.28 on 4 cores, far above the
  documented 2x-cores threshold where Stryker's dry run hangs or hard-crashes
  even at concurrency=1 (BL-108/BL-129/BL-139 lessons). Skipped per the
  office-hours mutation bypass; targeted property-test hardening substituted
  below; full differential mutation deferred to the next quiet pass — this
  does not block forwarding on its own, but is recorded so it is not silently
  read as having run clean.
- Correctness read (defect I can see, not just coverage/mutation):

## D1 — a doubly-superseded poll silently absorbs its vote (behavior)

**File:** `extension/src/tools/telegramCursorBridgeLive.ts`
**Class:** behavior (invariant violation, confirmed reachable — not a
synthetic mutant)

BL-894's own declared invariant 1: *"A tap the human makes on any selection
poll this bridge has posted either changes the queue or tells the human it
did not — a superseded poll never absorbs a tap in silence."* The
implementation only satisfies this for **one generation** of supersession.

`handleQueueInboundAction` (line ~1424-1428) and `clearQueuedPollIfStale`
(line ~412/427) both write the outgoing poll's id into a single scalar
field, `supersededPromptPollId: string | undefined` — not a collection.
Each subsequent `/queue` (or stale-clear) call **overwrites** that field
with the newest superseded id, discarding whichever id was there before.
`processQueuedPollAnswer` (line ~1523) checks membership against that one
scalar:

```
if (pollAnswer.poll_id === holder.state.supersededPromptPollId) { ... }
```

**Concrete failure scenario (verified with a targeted probe, not
hypothetical):** human queues 2 questions, sends `/queue` (poll A posted).
Poll scrolls off; human sends `/queue` again (poll A superseded, poll B
posted, `supersededPromptPollId = A`). Poll B also scrolls off; human sends
`/queue` a third time (poll B superseded, poll C posted,
`supersededPromptPollId` **overwritten to B** — the reference to A is now
gone). Human then scrolls back further and votes on the original poll A.
`processQueuedPollAnswer` finds `pollAnswer.poll_id` (`A`) matches neither
`pendingPromptPoll.pollId` (`C`) nor `supersededPromptPollId` (`B`) — the
function falls through and returns with **no post and no queue change**.
The tap vanishes in silence, exactly the failure invariant 1 was written to
rule out.

Reproduced directly against the compiled build:

```
posts after voting on doubly-superseded poll-gen0: []
queue after vote: [ { id: 'qp-1', ... }, { id: 'qp-2', ... } ]   // unchanged, but silent
```

Two consecutive `/queue` reposts is an ordinary, easily-reachable human
action (re-summon a scrolled poll, decide to re-summon again) — not an edge
case requiring adversarial input.

**Why this survived review:** the existing property test
(`telegramCursorBridgeLive.property.test.js`, "a vote on a poll this bridge
has superseded either changes the queue or tells the human it did not") and
acceptance scenario 03 both construct exactly **one** generation of
supersession (`poll-old` → one repost → vote on `poll-old`). Neither
exercises a second repost before the vote, so neither can see the second
generation silently dropping the first id. Matches this role's own
accumulated lesson: exercise a stateful selector/tracker with 2+ concurrent
candidates, not just one — here the "candidates" are generations of
superseded polls rather than concurrent gates, but the shape of the gap is
identical.

**Why this is not the hardener's fix to make:** closing this gap means
changing what the bridge tracks (a single scalar can't represent unbounded
history; the fix requires a design/implementation decision — e.g. a bounded
set/array of superseded ids, or checking Telegram's poll `is_closed` state
instead of tracking ids at all) and updating `CursorBridgePersistedState`'s
shape plus three call sites. That is production behavior, not a test
addition — outside "Does Not Own: do not introduce new product behavior."

**Remediation direction (not a mandate):** track superseded poll ids as a
collection (bounded is fine — Telegram poll history for one topic is small)
instead of a single scalar, and update `processQueuedPollAnswer`'s
membership check accordingly. Extend the existing property test to sweep
2-3 repost generations before the vote (the existing generator already
sweeps `n`/`selectedIndex`; add a `repostCount` dimension) so this class of
gap cannot regress silently again. Extend acceptance scenario 03 (or add a
03b) for the double-repost case.

Routed to **coder** as the earliest role whose domain owns this
implementation choice (the architect's P1 resolution already settled *that*
a repost should supersede rather than block — this defect is in *how many*
generations the tracking mechanism can represent, an implementation detail
the architect's decision did not depend on and did not decide).

By hardener.
