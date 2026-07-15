# Intake: Telegram approval reply flips the field correctly but confirms the wrong thing

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

## Suspected shape of the bug

Whatever composes the confirmation message likely re-checks "is there still a
pending approval for this ticket" AFTER the write already flipped the field to
`approved` — so the same pending-check used to decide whether to ACT on the reply
is being reused, post-write, to decide what to CONFIRM, and by then it correctly
reads "not pending anymore" and picks the generic "nothing to approve" text. The fix
is presumably to capture "there WAS a pending approval and I just approved it" as
its own outcome, before the write, and confirm with a dedicated success message
("Approved BL-412.") rather than re-deriving it from post-write state. Same
subsystem as `pendingApprovalReply.ts` / `needsHumanDetection.ts` / the Telegram
front-desk bot; worth checking whether BL-409/BL-395 (already in flight) touch the
same code path before this becomes a third overlapping ticket in the area.

## Scope note

Coordinator has already promoted BL-412 itself (now `human_approval: approved`,
no unmet `depends_on`) despite the wrong confirmation — the approval field is the
source of truth, not the bot's reply text. This intake is about the CONFIRMATION
MESSAGE being wrong/misleading, not about the approval failing.
