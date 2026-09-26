# Unowned red: extension/test/nightClosingCeremonyRun.test.js (2026-09-25)

Found while hardening BL-1711 (post-bounce pass). Not related to this
ticket's own diff — reproduces with BL-1711's own work stashed away, and
after a fresh `npm run compile`.

3 of 20 tests fail, deterministically (reproduced twice):
- "BL-1641: at the hard deadline, ensure-briefing lands the documenter
  commit and folds the step before swarm-stopped" — `landDocumenterBriefing
  was not called`.
- "BL-1641: when landing fails, ensure-briefing falls back to composing
  the headless briefing" — `actions.some((a) => a[0] === 'land')` is
  false.
- "BL-1641: when neither lands nor composes, the sequence still ends
  briefing-missing, swarm-stopped with no forced step" — sequence tail is
  `['freeze-promotion']` instead of `['briefing-missing',
  'swarm-stopped']`.

Not tracked: no row in `backlog/standing-reds.tsv`. `backlog/done/BL-1641-
a-ceremony-at-its-briefing-deadline-produces-a-briefing-before-the-stop.yaml`
(the ticket that added this test) is already `done` — its own land is not
what regressed this; something later in main's history changed
`ensure-briefing`'s dispatch (freeze/land/compose sequencing) without this
test's own expectations being updated, or vice versa.

Reproduction: `cd extension && npm run compile && npx vitest run
test/nightClosingCeremonyRun.test.js` — 3/20 fail on this worktree's tip
(`a3875de1c6` merge-base with `main`), unrelated to any BL-1711/1698/1704/
1760/1762 content from this session.

Not routed as a parcel or a bounce — this ticket needs no code change for
it; sent as an `unowned-red` note to the specifier per Article 4.2/BL-1063
so it gets an owning ticket rather than surfacing again on a future pass.

By hardender.
