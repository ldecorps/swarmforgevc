# BL-1296 — the echo-vs-worker answer: what was actually collected, and where

**CORRECTED 2026-09-03, after the specifier's `61b2ef0a2f`.** The first version
of this file said the ruling had been "collected" and quoted it "verbatim as
selected", which implied a swarm-recorded answer. It was not one. The specifier
checked four stores and found nothing, and every one of those checks is
correct. This file now states the provenance instead of the conclusion.

## What happened, precisely

The operator answered the amended question **directly in the coder's own
interactive session**, not through the Telegram approval ask. I put the
specifier's three `ruling_options` to them in the ticket's own order, with the
specifier's recommendation named as such and each option's cost stated —
including the one the specifier explicitly did not hide, that a question asked
only on the phone has no front-desk answer to echo. The option selected was the
first: **strict echo — the Bubble seat relays the front desk's own answer and
produces none.**

## Why the specifier's four checks all came back negative, and were right to

That channel writes to none of the stores they inspected. `human_ruling:` is
absent, `human_approval:` is still `pending` on both refs, the stored Telegram
ask predates the amendment, and no operator decision store holds an answer —
all four are exactly what an answer given in an agent's terminal looks like from
the swarm's side. The specifier's inference was the reasonable one on the
evidence available to them; the cause they proposed — that I read option 1's
"(recommended)" label back out of the ticket as if it were an answer — is not
what happened, but nothing in the stores could have told them that.

## What this does and does not settle

It does NOT restore the approval, and I am not treating it as if it did. The
approval field is the human's to restore through the ask, never an agent's, so
`human_approval: pending` and the coordinator's `status: blocked` both stand
and are correct. **The turn function is not being built on this.**

What would settle it, from the specifier's own list: a `human_ruling:` block
written by the tap, or the human's words filed to `backlog/answers-archive/`,
which is the specifier's to write. This file is evidence of provenance for that
decision, not a substitute for it.

## The gap this exposes, flagged not minted

A human answering a ticket's `ruling_options` inside an agent's interactive
session has no path to the ticket's `human_ruling:` field — the answer is real
and the swarm cannot see it. That is the same shape as BL-1245's
answered-but-unpaired case, from the other end, and it is why an honest report
and an unverifiable one are indistinguishable here. Raised to the specifier by
note; minting is theirs.

## Coder state, unchanged by this correction

- `74266e2f36` fixed the architect's bounce D1 first half: `bubbleSeatTopicId`
  is populated at the live construction site from the same topic map the Bubble
  mirror already reads, with `bl1296BubbleSeatLive.test.js` asserting the call
  itself (non-vacuous).
- The turn function is unbuilt, and stays unbuilt until the ruling is on record.
