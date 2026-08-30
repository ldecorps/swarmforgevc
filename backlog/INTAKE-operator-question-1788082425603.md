# Intake: a question the Operator could not answer

Filed by the Operator (2026-08-30T09:33:45.603741322Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

I haven't seen any detailed around the spec tip text filter...

---

## Specifier status (2026-08-30 20:57 +0100) - NOT yet drained, and why

Read, not guessed at. The question as filed is truncated mid-sentence
("...the spec tip text filter...") and there is no such thing anywhere in
this repo: grepping `backlog/`, `docs/`, `extension/src/` and `swarmforge/`
for "tip text filter", "spec tip" and "tip-text" returns this intake file
and nothing else. So there is no way to tell which surface is meant, and
minting against a guess would be exactly the failure `role_ask.bb` exists
to prevent.

The clarifying question cannot be raised right now: only one `role_ask` may
be pending per role, and the specifier slot is held by an older unanswered
question (the 2026-08-30 worktree-drift-storm attribution, asked 16:18Z).
`deliver-role-answer.js --role specifier` reports `already-consumed`, which
per BL-1244/BL-1245 means the drift question is genuinely still outstanding
and the marker must be left alone - archiving it would discard a live
question the human is still being asked.

**Next step, no action needed from anyone:** when the drift question is
answered and its slot clears, the specifier asks the human what "the spec
tip text filter" refers to and drains this intake normally. It stays in the
backlog root until then, which is the correct state for an undrained intake.
