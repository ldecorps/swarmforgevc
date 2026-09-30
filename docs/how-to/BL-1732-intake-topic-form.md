# Filing an intake from the Intake Telegram topic

The **Intake** forum topic lets the principal file a new backlog intake from
their phone in one ubiquitous language, instead of hand-writing an
`INTAKE-*.md` file. This is slice 1 of the telegram-intake-builder epic
(BL-1731): the topic, its Mini App form, and Submit. Kept drafts and
deleting vocabulary values are BL-1733; Verify and Ask Specifier are later
slices.

## Opening the form

The standing **Intake** topic is created and reused like the other standing
forum topics (Agent Questions, support/intake), and answers only the
principal — anyone else's message there is ignored. Forum topics cannot
carry a `web_app` button, so the topic itself replies with an inline **"Open
the intake form"** button, a plain `url` button rather than text to tap:

> File a new intake: [Open the intake form]

The actual Mini App button (`web_app`) rides a separate message to the
principal's private chat (the same pattern as the operator console). If the
tunnel serving the bridge is down, the topic says so instead of posting a
dead button:

> The Intake form is unreachable right now - the tunnel serving it is down.
> Try again once it is back up.

## The form

Served at `/intake-form` on the bridge, alongside `/epic-reorder` and
`/catch-up` — reachable with `?bearer=` to read, the control token to
write. One draft at a time in this slice.

- **Narrative.** Three dropdowns — actor, action, goal — over a shared,
  seeded vocabulary (`backlog/vocabulary/intake-narrative.yaml`). Each has
  an "add new…" option: a value you add is usable in your draft
  immediately, but only joins the shared list when you submit a draft that
  uses it — someone else's still-open draft never sees it early.
- **Scenarios.** One or more free-text Given/When/Then (plus And/But)
  blocks.
- **Rule (optional).** "Any rule that should always hold?" — free text.
  It travels with the intake file whenever it holds text; a blank rule
  leaves no rule section at all. Nothing derives from it or checks it in
  this slice — Verify proposing an invariant from the scenarios (BL-1735)
  is a separate, later mechanism.
- **Notes (optional).** Free text.

The page keeps no browser storage (all state is either in memory or comes
back from the bridge).

## Submit

Submit writes `backlog/INTAKE-<slug>-<yyyymmdd>.md` at the backlog root —
the specifier's usual intake queue — holding "As `<actor>`, I want to
`<action>`, so I can `<goal>`.", the scenarios, the rule section (when not
blank), and the notes. A same-day intake with the same slug never
overwrites an earlier one: the writer walks a `-2`, `-3`, ... suffix until
it finds a path nothing already occupies. The file and any new vocabulary
value are committed together through the front desk's own commit-integrity
path (`commit_integrity_cli.bb`), so the write lands on `main` durably
rather than sitting uncommitted on disk. The topic then confirms with the
committed file's GitHub permalink (the permalink resolves once `main`
reaches `origin`). If the commit itself fails, Submit rolls back: neither
the INTAKE file nor the vocabulary change is left on disk, so a refused
Submit files nothing and shares nothing.

A submit made without the bridge's device and control tokens is refused,
and no file is written.

## Starter vocabulary

Seeded once, on first read — see `intakeVocabularyStore.ts` for the full
starter list (actors: the human, a phone user, a SwarmForge VC user, the
operator, and each pipeline role; actions and goals drawn from the
telegram-intake-builder epic's own clarification round). The human deletes
what they don't want in BL-1733; nothing in this slice removes a value.

## Scope

- `extension/src/tools/telegram-front-desk-bot.ts` /
  `telegramTopicDecisions.ts` — the topic and its reply.
- `extension/src/bridge/intakeFormUiHtml.ts` + the bridge routes in
  `bridgeServer.ts` — the form itself.
- `extension/src/bridge/intakeVocabularyStore.ts` — the shared vocabulary
  store and its seed.
- `extension/src/bridge/intakeWriter.ts` — the INTAKE file writer and the
  permalink confirmation text.

Out of scope for this slice: kept drafts and deleting vocabulary values
(BL-1733); Verify and Ask Specifier (BL-1734–BL-1737); the support/intake
🎟 SUP threads (BL-418), which this topic is separate from and does not
change.
