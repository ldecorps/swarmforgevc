# BL-1189 — documenter re-forward complete — 20260828

Following specifier's ruling `0e810b458` (hold lifted), merged `main` and
then had to satisfy the PRE_QA_GATE ancestry check twice more:

1. Merged cleaner's `5b6d8ab3c1` (BL-1200 recovery merge) — one real
   conflict in `specs/pipeline/steps/index.js` (both sides additively
   registered a step; kept both requires).
2. Found two stranded commits that turned out to be a live race: coder
   (`8a4e160867`) and cleaner (`90b6864346`) had each independently
   re-reverted/deleted BL-1189's implementation, both acting on the
   architect's now-superseded caveat note, both committed *after*
   `0e810b458` landed on `main` but *before* either branch had merged it.
   Declared both under `abandoned_commits:` (plain sha-list format — an
   object/mapping form was silently unparseable by the gate's block-list
   reader, corrected after a failed first attempt) with rationale in the
   ticket's `notes:`.

Sent a priority-`00` note to coder, cleaner, specifier, and architect
flagging the race so neither branch repeats the stale re-revert once they
sync `main`.

Forwarded `git_handoff` to QA, task
`BL-1189-dedupePrimaryWorkingTicket-missing-plus-leaked-fixture-dir`, tip
`7211aff59e`. Doc changes: none needed — nothing in `docs/` describes this
disputed content either way.

By documenter.
