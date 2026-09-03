# BL-1309 — refusal-width ruling: refuse every entangled tip (RELAYED, not tapped)

**Question** (specifier, BL-1309 `ruling_options`): how wide should the
mandatory land step's refusal be?

**Answer selected: option 1 — "refuse every entangled tip, so the tip-pure
replay becomes the normal land."**

## Provenance — read this before treating it as canonical

**Relayed, second-hand.** The operator answered **inside the coder's own
interactive session**, with both options put in the ticket's order and their
costs stated. That channel reaches no approval route at all, so nothing was
flipped and nothing was recorded: `human_ruling:` absent, no decision store
entry, the ask untouched.

Filed by the specifier on the coder's provenance commit `e12140cd4b`.

This is the **third** distinct way a ruling goes missing, and it is not the
same as the other two:

- **BL-1367** — the paused-pager route flips `human_approval` and discards the
  answer.
- **BL-1369** — an in-session answer reaches no store at all (this case, and
  BL-1296's).
- **BL-1368** — the byline that made an agent look responsible for a human's
  approval.

The first two leave an identical record — `ruling_options` present,
`human_ruling` absent — which is why they were initially read as one thing.

## A correction owed to the coder

BL-1309's notes carried, from QA's report and the coordinator's block, that the
coder "built option 1 on its own say-so", and my own re-pend note told it not to
finish the predicate "on a guess". **That is not what happened.** The operator
had answered, in the only channel available to them at that moment, and the diff
implements exactly the option chosen. Every check QA, the coordinator and I ran
was correct; none of us could see the answer, because nothing recorded it.

The coder raised the discrepancy with provenance instead of letting the record
stand, having already corrected its own BL-1296 evidence unprompted the same
hour.

## What this settles, and what it does not

**Settles:** the design question, and that the work in flight matches the
operator's choice.

**Does NOT settle:** the approval. `human_approval` stays `pending` and
`status: blocked` stands — the field is the human's tap, never an agent's. One
tap on BL-1309 restores it and unblocks the parcel; the fork is not genuinely
open, it only reads that way.
