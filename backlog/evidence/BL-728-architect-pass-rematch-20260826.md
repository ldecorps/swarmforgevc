# BL-728 — architect pass (rematch) — 20260826

- merge_and_process cleaner tip `8bc439e514` (conflicts in BL-723/BL-727 how-tos
  and BL-728 feature mutation stamp — resolved to cleaner/incoming).
- Tree preserved: **8810** tracked paths (additive merge; no sparse collapse).
- Rematch removes out-of-scope BL-1153 font-reload test from
  `residentSpyUiHtml.test.js` (BL-506 hygiene after prior architect pass note).

## Architecture / boundaries

- Babashka/shell verification slice unchanged; no extension production surface.
- Dependency gate (`residentSpyUiHtml.test.js`): **PASSED** — deletion only.
- Co-change: expected resident-spy UI test coupling; no new forbidden edges.

## Invariants

- Process invariants from prior pass unchanged; acceptance + evidence remain the
  executable encoding.

## Property-testing pass

- No touched pure TS production modules.

Pass → hardender.

By architect.
