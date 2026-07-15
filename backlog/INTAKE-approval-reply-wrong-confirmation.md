# Intake: Telegram front-desk sends a wrong/generic "Nothing to approve right now" for ANY unrecognized reply in a ticket's topic

**UPDATE 12:18 BST — original theory below is WRONG, see "Second occurrence" section
first.** The bug is broader than "confirms the wrong thing after a successful
approve": the SAME canned reply also fires for an unrelated, non-approval
question, on a ticket that is STILL genuinely pending (no write happened at
all). The common thread across both occurrences is that any inbound message in
a ticket's topic which isn't an exact match for the approve keyword gets this
one generic fallback string, regardless of (a) what was actually asked and (b)
whether the ticket is actually still pending. Read the whole file — the
original write-up is left below for the evidence trail, but its root-cause
guess (a post-write re-check) does not explain the second occurrence.

## Second occurrence (BL-414, 12:13-12:15 BST) — disproves the original theory

- 12:13 bot (pinned): "This ticket needs your approval before it can proceed.
  Reply here with \"approve\" to approve it."
- 12:14 human: "Where is the introducting summary?" (a real question — BL-412's
  topic had gotten an automated ticket-summary message and BL-414's had not;
  the human was asking why)
- 12:15 bot: "Nothing to approve right now."

Verified: `backlog/paused/BL-414-topic-title-age-suffix.yaml` still reads
`human_approval: pending` — no approve/reject keyword was sent, nothing was
written, the ticket genuinely IS still pending approval. So this reply is
wrong on two independent counts: it doesn't answer the question asked, and it
is factually false even taken as a generic status statement (there IS
something to approve — this exact ticket). Whatever handles an inbound
Telegram message in a per-ticket topic appears to funnel any input that isn't
an exact "approve"/"reject"/"amend" match straight to one static fallback
string, without checking the ticket's own current pending state or attempting
to answer free-text questions. Topic record: `backlog/topics/BL-414.json`,
human message `updateId: 765184564`.

## Original write-up (first occurrence, BL-412) — kept for evidence, root-cause guess below is superseded

Filed by the coordinator (2026-07-15T12:xx BST) - the human sent a screenshot of the
BL-412 Telegram topic showing this exchange:

- 11:53 bot (pinned): "This ticket needs your approval before it can proceed. Reply
  here with \"approve\" to approve it."
- 12:07 human: "Approved"
- 12:08 bot: "Nothing to approve right now."

This is a RAW ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## What actually happened (verified against the repo)

The approval WAS processed correctly: `backlog/paused/BL-412-disk-space-early-warning-alert.yaml`
had `human_approval: pending` flipped to `human_approval: approved` in the master
checkout at the same time as the human's reply (confirmed via `git diff` — matches
the `backlog-schema.md` "replying approve in that topic flips this field back to
approved" contract). The topic record `backlog/topics/BL-412.json` records the same
three messages above (seq 0-2, `updateId":765184561` on the human's inbound message).

So the WRITE succeeded, but the bot's own confirmation text ("Nothing to approve
right now") tells the human the opposite — that the approval didn't do anything. A
human seeing that message has no way to tell, from the Telegram thread alone, that
their approval landed; the natural response is to distrust the mechanism or resend
the approval.

## Suspected shape of the bug (SUPERSEDED — see the BL-414 second occurrence above)

~~Whatever composes the confirmation message likely re-checks "is there still a
pending approval for this ticket" AFTER the write already flipped the field to
`approved`~~ — this cannot be the whole story: BL-414 hit the identical reply
text with no write and a genuinely still-pending ticket. The more likely shape,
consistent with BOTH occurrences: the reply handler recognizes one narrow input
(the exact "approve" keyword, matched against SOME ticket's pending state — see
below) and funnels every other inbound message, including real questions and
including replies inside a topic whose OWN ticket is still pending, to one
static fallback string. A plausible refinement: the handler may be checking
"is there a *globally* pending approval to act on" rather than "is *this
topic's* ticket pending", so between the BL-412 case (already flipped
approved by the time of a later stray message) and the BL-414 case (a
different ticket's topic, possibly not the one the handler considers
"current") both land on the same "nothing" branch for different reasons —
worth the specifier checking whether the front-desk tracks one global pending-
approval slot rather than per-topic state. Same subsystem as
`pendingApprovalReply.ts` / `needsHumanDetection.ts` / the Telegram front-desk
bot; worth checking whether BL-409/BL-395 (already in flight) touch the same
code path before this becomes a fourth overlapping ticket in the area.

## Scope note

Coordinator has already promoted BL-412 itself (now `human_approval: approved`,
no unmet `depends_on`) despite the wrong confirmation — the approval field is the
source of truth, not the bot's reply text. This intake is about the CONFIRMATION
MESSAGE being wrong/misleading, not about the approval failing.
