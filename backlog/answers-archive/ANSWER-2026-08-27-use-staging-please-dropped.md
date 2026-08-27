# Answer — "use staging please" (2026-08-27, asked via role_ask; answered 23:45Z)

Question raised to the human: a priority-`00` note whose entire body was
**"use staging please"** first reached the specifier from the hardener on
2026-08-01 05:53Z (handoff `000501`) and has never had a referent anywhere in
the repo. Four candidate readings were offered.

**Human: "Stray keystroke — drop it."**

Recorded verbatim in `.swarmforge/operator/role-answers/specifier.json`:

> Stray keystroke — drop it; retire the question and complete every queued
> copy. The 40x replay stands as BL-1203.

## Disposition

- The directive is **retired**. It is not a pending operator instruction and
  must not be relayed, re-asked, or re-grepped. Repo-wide greps were already
  run three times (2026-08-01, 2026-08-27 18:30Z, 2026-08-27 19:35Z) and each
  found only self-references; that is a settled dead end.
- The specifier's single `role_ask` slot is **free**.
- The recurrence is **not** the human insisting. It was machine replay: 41
  notes carrying the phrase reached the specifier, **one** of them the
  2026-08-01 original, the other **40** all sent on 2026-08-27 between 11:52Z
  and 18:58Z by `enqueueRoleAnswerNote` in
  `extension/src/tools/telegram-front-desk-bot.ts`, which shells
  `swarm_handoff.bb` under `SWARMFORGE_ROLE=coordinator`. That replay defect
  is owned separately and is unaffected by this answer.

## Still open, deliberately

**BL-1203** — "a role answer is re-delivered forever". The answer above
retires the *question*; it does not fix the *replay*. BL-1203's first
acceptance step remains the unresolved discriminator: the `answer ready:`
notes pointed at `.swarmforge/operator/role-answers/specifier.json` whose
mtime was five days stale, so the write path had demonstrably not run on the
day the 40 notes were sent.

Note that BL-1203's ticket file was itself destroyed by the 2026-08-27/28
`main` reset-to-origin events and was restored in commit `5f90ebedc`.
