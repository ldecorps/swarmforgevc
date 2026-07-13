# INTAKE: Replies must return to the thread the human asked in

**Raised by:** the human (ldecorps), 2026-07-13.
**Relayed via:** the Claude Code recovery session of 2026-07-13, at the
human's request ("file away"). Human-raised; the relay is transport, not
authorship.

## The defect, as the human experienced it

The human asked questions in the **General** topic four times across one day
(08:53, 09:54, 11:08, 13:05, then "So?" at 15:41) and saw total silence,
concluding repeatedly that the swarm was dead. It was not: the front desk
received every message, the operator processed them and replied — but the
replies landed in a **different topic** than the one the human typed in.

## Mechanism (verified in code during the incident)

`telegramFrontDeskBotCore.ts` (BL-294): a message with no
`message_thread_id` — which includes every message posted in a forum
supergroup's General topic, not just DMs — resolves through
`DEFAULT_SUBJECT_KEY` to the single default support subject (SUP-2 today).
The reply relay then routes the answer to the topic mapped to THAT SUBJECT
(`topicForSubject`), i.e. the SUP support topic — never back to General.
Question in General; answer in SUP; human sees neither connection nor answer.

## The ask

A reply to a human message must be delivered to the thread the human posted
in. General included. If General genuinely cannot be replied into (it can —
it is an ordinary thread id 0/absent case), then at minimum the bot must
post a pointer in the asking thread ("answered in <topic>") so silence is
impossible. The invariant worth pinning in a test: for every inbound human
message, SOME visible response lands in the same thread within the reply
window.

## Adjacent, do not duplicate

- BL-346 (standing Operator topic) reduces how often the human uses General,
  but does not fix the routing dishonesty for the threads it still affects.
- BL-333/BL-345 (starvation alarms) cover events not being consumed; this
  defect is the opposite case — consumed, answered, misdelivered.
