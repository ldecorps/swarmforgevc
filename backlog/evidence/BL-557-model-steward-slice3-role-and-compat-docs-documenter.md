# Documenter evidence — BL-557-model-steward-slice3-role-and-compat-docs

## Ticket
BL-557-model-steward-slice3-role-and-compat-docs

## Hardener tip
8127b9c4ec

## Docs impact
- Coder already generated `docs/reference/model-compatibility.md` via `compat-docs` (do not hand-edit).
- Linked that matrix from `docs/index.md` (Reference).
- Extended `docs/how-to/BL-547-model-steward-overview.md` with Slice 3: coordinator-assignable steward (no standing pane), `compat-docs` regeneration.
- Spec Last Updated + architecture.mmd note for BL-557.
- Role prompt / CLI / registry schema remain coder-owned; documenter surfaces operator-facing docs only.

## Acceptance cross-check
Aligned with `specs/features/BL-557-model-steward-slice3-role-and-compat-docs.feature` (role graduation + generated compat docs).

## Follow-up
Slice 3 how-to section landed in a second commit after the first tip (handoff draft format fix: type/priority/commit, to: QA).
