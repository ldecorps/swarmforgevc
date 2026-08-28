# BL-1190 cleaner merge-up recovery (2026-08-28)

## Context

Third QA merge-up in a row on this pass (see
`BL-592-cleaner-merge-recovery-20260828.md` and
`BL-1188-1189-cleaner-merge-recovery-20260828.md` for the first two).
Unlike the prior two, this one carried real, legitimate forward progress
(BL-1184's shift-velocity briefing chart landed cleanly, auto-merged with
no conflict and no loss) alongside the recurring silent-drop pattern.

## What was silently dropped this time

8 architect investigation/bounce evidence files documenting the
BL-592/BL-1188/BL-1189 tree-collapse incidents were missing on QA's
`e9fd27b9cd` line despite their authoring commits (`2095a4728`,
`b9637a64f`, `9b86a7810`, `2ab3527d5`, `364b223bf`, `1cc8402ba`,
`a4005504d`, `f66b20f9a`) all confirmed ancestors of QA's tip. Restored
all 8 from this worktree's HEAD.

## Content conflicts (unioned, nothing dropped)

- `backlog/active/BL-1190-*.yaml` notes — QA's side had a coordinator
  promotion-hold note HEAD lacked; kept both.
- `backlog/topics/BL-428.json` — HEAD had 3 chat messages (approval →
  done → re-opened in-progress) reflecting the real re-close history after
  BL-1214's rematch reset; QA's side was missing the "done" message
  entirely. Kept HEAD's superset.
- `specs/pipeline/steps/index.js` — same accumulating-requires-list
  pattern as the prior two merges; kept HEAD's fuller list (already
  included both entries QA's side had).

## What I did NOT touch (legitimate forward progress)

- `swarmforge/scripts/handoffd.bb`, `briefing_email_lib.bb` — BL-1184's
  shift-velocity chart wiring, auto-merged clean, ADDING content HEAD
  didn't have (the opposite direction from the recurring revert pattern).
- `backlog/paused/BL-{472,565,644,691,882}-*.yaml` deletions — each
  ticket verified present at its new location (`active/`, `done/`, or
  `hold/`), real forward bookkeeping.
- `specs/features/BL-428-decrap-paneHistory-slice.feature` deletion — the
  ticket's own notes document this was deliberately renamed to
  `.feature.draft`, which exists; not a loss.
- `docs/index.md` — additive doc-index entry for BL-1190.

## Verification

- `npm run compile` — clean.
- `bl896_briefing_diagram_source_independence_property_runner.bb` — 500/500 pass.
- BL-1190 acceptance feature — 4/4 pass.

By cleaner.
