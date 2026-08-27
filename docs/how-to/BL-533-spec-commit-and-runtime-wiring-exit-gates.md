# Exit gates: committed acceptance + epic runtime wiring (BL-533)

Claimed deliverables must be **tracked** and **wired** before close — not
present only as an untracked working-tree file or an epic with no
`required_wiring` children.

## Gate 1 — acceptance commit-tracking

`specifier_backlog_hygiene_gate` (via `backlog_hygiene_lib`) fails closed when
`acceptance:` points at a feature path that exists on disk but is **not** in
`git ls-files` (`untracked-acceptance`).

Partner checks:

- Mint dangling pointer: [BL-1027](BL-1027-mint-time-gate-refuses-a-dangling-acceptance-pointer.md)
- Promotion missing/draft feature: [BL-626](BL-626-promotion-gate-rejects-unmaterialized-feature-draft.md)
- Pre-QA missing blob at cited commit: BL-880 / handoff acceptance checks

## Gate 2 — multi-slice epic wiring checklist

An epic with **≥2** `decomposes_into` children fails the wiring exit checklist
unless at least one child declares a non-empty `required_wiring` list
(`epic-wiring-exit-checklist` in `backlog_hygiene_lib.bb`, surfaced through
`backlog_epic_milestone_audit`).

## Operator note

If hygiene names an untracked acceptance path: `git add` the feature and
re-run the gate. If an epic fails the wiring checklist: add `required_wiring`
to at least one child (or reduce the epic to a single slice).

Acceptance:
`specs/features/BL-533-spec-commit-and-runtime-wiring-exit-gates.feature`
