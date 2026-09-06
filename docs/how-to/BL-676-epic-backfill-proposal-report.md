# Epic backfill proposal report (BL-676)

427 of 497 closed tickets predate consistent `epic:` tagging, which
undercounts most of what shipped in any epic-grouped history view (BL-592's
spec tree). This is slice 1: a deterministic, **read-only** report
proposing an epic for each untagged `backlog/done/` ticket, for a human to
review and amend. Applying anything is a separate, later slice (BL-677),
gated on this report being human-approved — nothing here writes a backlog
file.

## Run it

```bash
bb swarmforge/scripts/epic_backfill_proposals_report.bb [project-root]
```

Writes one report to `backlog/evidence/BL-676-epic-backfill-proposals-report.md`
— a markdown table, one row per `backlog/done/` ticket (enumerated
recursively; done items nest in milestone subfolders) whose `epic:` field
is missing or empty. Already-tagged done tickets are excluded.

## Confidence tiers, per row

- **milestone-map** — an existing milestone cleanly maps onto one epic
  (the map itself, derived from the live epic trackers' own `milestone:`
  fields, is data the human can veto wholesale).
- **roster-match** — the ticket's title/source keyword-matches a live
  `type: epic` tracker (id, title, or a `decomposes_into` child) enumerated
  from `backlog/`; the evidence column names what matched. The epic
  vocabulary is exactly this roster — never a novel string.
- **needs-judgment** — no signal clears the confidence bar. The proposal
  cell is left EMPTY for a human to fill; the report never guesses here.
- **pre-epic-era** — the ticket's milestone predates the earliest roster
  epic's and matches nothing: proposes the documented sentinel epic value
  `pre-epic-era` (`swarmforge/backlog-schema.md`), never a fabricated
  tracker.

## Determinism

Same repo state, same report, byte for byte — no network, no LLM calls, no
wall-clock content in any row. `git status` after a run shows only the
report file changed.

Acceptance: `specs/features/BL-676-epic-backfill-proposals.feature`.
