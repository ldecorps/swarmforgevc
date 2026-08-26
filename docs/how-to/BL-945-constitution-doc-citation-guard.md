# BL-945: The Constitution Doc-Citation Guard

**`extension/test/constitutionDocCitations.test.js` fails the standing
extension suite if a constitution article cites a `docs/...` path that does
not exist on `main`.**

## The Problem This Fixes

`swarmforge/constitution/articles/local-engineering.prompt` Architecture
Rule 6 cited `docs/branding/icon-system.md` §4d as normative authority — but
the file existed only on an unmerged branch (`origin/branding/epic-marks`)
and was unreadable from every agent's own worktree, each a checkout of
`main`. `extension/src/concierge/epicIcon.ts` and `topicIcon.ts` cited the
same doc's §5a in comments. The rule survived only as whatever the
article's one-line summary happened to say — and that cost real spec
quality: an operator intake proposing to expand `EPIC_ICON_POOL` was
unbuildable for a reason only §5a's Telegram-sticker-set census explained,
and nothing on `main` would have surfaced that before a ticket got written
for the impossible version.

`docs/branding/icon-system.md` has since landed on `main` (design-exploration
content, not yet ratified — see its own status line; it lives outside the
Diátaxis taxonomy alongside `docs/design/`, not linked from `docs/index.md`).
This guard is the standing half: the next dangling citation is caught at the
commit that writes it, not months later by someone digging through branches.

## What It Checks

`specs/pipeline/steps/lib/constitutionDocCitations.js` scans every
`.md`/`.prompt` file directly under `swarmforge/constitution/articles/` and
its `reference/` subdirectory for backtick-quoted `` `docs/...` `` paths, and
reports any that do not resolve relative to the repo root.

Scoped deliberately narrow, to keep the guard's noise floor at zero:

- **Backtick-quoted `docs/` paths only.** Articles also backtick-quote
  scripts (`` `swarm_handoff.sh` ``), config (`` `swarmforge.conf` ``), API
  calls, and bare cross-article filenames (`` `05_amendments.md` ``,
  `` `PIPELINE.md` ``) — none of those are doc citations and none should be
  flagged. A bare `docs/` directory mention with no filename following it
  (e.g. "Diagrams live under `` `docs/` `` as text-based sources") stays
  correctly unflagged too.
- **Constitution articles only.** `epicIcon.ts`/`topicIcon.ts` cite the same
  doc in source comments, and they are what made this drift visible, but
  scanning arbitrary code comments for prose references is a noisier,
  separate problem — out of scope for this ticket, a candidate follow-up.
- **A citation is a defect solely because the path does not resolve** — never
  because of how it is spelled, cased, or punctuated. A check that flagged a
  resolvable path would be worse than no check, because that noise is what
  gets a guard switched off.

Every real citation in the corpus must be backtick-quoted for the scanner to
see it. `project.prompt`'s two non-backtick citations
(`docs/reference/Specification.MD`, `` docs/explanation/Milestone Roadmap.MD ``)
were normalized to the backtick convention as part of this ticket rather
than widening the regex — the simpler, more robust fix once the scanner's
narrow scope was already deliberate.

## What Happens Now

Runs as part of the standing extension suite (`npm test` from `extension/`),
the one suite every parcel runs — not `specs/pipeline/test/`, which no
standing gate runs (the exact way BL-944's sibling fixture-list drift went
unnoticed for two weeks). On a dangling citation, the suite fails naming the
citing article and the unresolved path.

## What To Do When You See It

Either land the cited doc at that exact path, or fix the citation — remove
it, correct the path, or backtick-quote it if it was written as plain prose
(the scanner only sees backtick-quoted `` `docs/...` `` paths). Constitution
articles are specifier-owned; a role hitting this guard on a citation it
didn't write raises it to the specifier rather than editing constitution
prose itself.

## What This Deliberately Does Not Do

- It does not check source-comment citations (`epicIcon.ts`, `topicIcon.ts`,
  or any other code file) — constitution articles only.
- It does not validate a citation's *section* (e.g. that §4d still exists
  inside the target doc) — existence of the file only.
- It does not touch `EPIC_ICON_POOL`, `ICON_EMOJI`, Architecture Rule 6, or
  any epic-icon behavior — this ticket made the existing authority readable
  and changed no rule. The icon-pool question is a separate, live design
  decision with the human.

## See Also

- `specs/pipeline/steps/lib/constitutionDocCitations.js` — the pure
  `extractDocCitations`/`findUnresolvedCitations` scan.
- `extension/test/constitutionDocCitations.test.js` — the standing gate.
- `extension/test/constitutionDocCitationsInvariant.property.test.js` —
  property coverage for the declared invariant (flags only unresolvable
  paths, never a resolvable one regardless of casing/punctuation).
- `docs/branding/icon-system.md` — the doc this ticket made readable from
  every worktree.
- **BL-640** — the sibling pre-turn guard for `articles/reference/`
  worktree-vs-`main` drift; a different failure mode (staleness, not a
  dangling citation) over a different surface, see
  `docs/how-to/BL-640-reference-freshness-guard.md`.
