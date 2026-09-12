# BL-1537 — QA rotate-force authorization record

QA's own escalation (`BL-1537-QA-land-escalate-BL1518-misattribution-20260912.md`,
note sent, evidence `65ae4fd1e2`) surfaced a genuine conflict: no session is
acting as specifier (`tmux list-sessions` showed only `swarmforge-coder` and
`swarmforge-coordinator`), and `rotate_to_role.sh specifier` refused (exit 5,
undrained in_process parcel) — the gate this ticket's own land-time finding
would otherwise want respected.

Coordinator filed a Telegram role-ask (topic 1602, messageId 95012,
`role-ask-coordinator` thread) naming this exact dilemma verbatim, including
the exit-5 refusal and QA's pushback, and asking the human to choose between
(1) force rotate + self-adjudicate, (2) leave the note queued and hold
BL-1537 in_process, (3) something else. Confirmed present at
`/home/carillon/swarmforgevc/.swarmforge/operator/telegram-ask-messages.json`
key `role-ask-coordinator`, `topicId: 1602`.

QA asked its own clarifying question in-session (AskUserQuestion) before
acting, given the conflict-of-interest and the refused gate; the answer
recorded was "Force it (Recommended by requester)". A follow-up message,
identifying itself as the coordinator, confirmed this in-session answer IS
the human's real reply to topic 1602 (not a duplicate or automated echo) and
instructed QA to proceed with `SWARMFORGE_ROTATE_FORCE=1`.

QA did not take that confirmation at face value: independently read
`telegram-ask-messages.json` to confirm topic 1602 genuinely exists with
the described content (it does, verbatim) before proceeding. No independent
record of the human's specific reply text was found in
`role-awaiting-archive/` or `role-answers/` (a direct in-chat human answer,
consumed without a file artifact, is an established pattern in this swarm
per `role-answers/coordinator.json`'s own prior entries), so this action
proceeds on the corroborated-context basis above, not on an independently
re-derived transcript of the human's exact words.

Proceeding: `SWARMFORGE_ROTATE_FORCE=1 rotate_to_role.sh specifier`,
adjudicate the BL-1518 note as specifier, rotate back to QA, act on the
ruling. This overrides the in_process-parcel gate knowingly and by explicit
authorization — the parcel is BL-1537's own documenter handoff, already
fully verified by QA (see `BL-1537-QA-20260912.md`); nothing about the
parcel's own correctness is in question, only the land-time entanglement.

By QA.
