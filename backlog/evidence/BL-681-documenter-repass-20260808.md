# Documenter re-pass — BL-681 (2026-08-08, QA-bounce re-entry)

## Context

Re-entry after QA bounced BL-681 (and sibling BL-762) for D1
(`finish_shift_lib.sh` missing from the residual-facilitator allowlist,
owned by coder) and D2 (BL-681's own `acceptance:` YAML field still
pointing at the pre-promotion `.feature.draft` path, owned by coder) — see
`backlog/evidence/BL-681-BL-762-qa-bounce-20260808.md`. Neither defect is
in the documenter's domain; nothing here asks me to redo doc work.

Received `git_handoff` from hardender (task BL-681, commit `0d2f948009`,
a re-pass merging architect's re-forward). Merged clean into my prior tip
(`a88d7764`, my own earlier bounce-evidence commit for this same D2 defect).

## Fix verification

- D1: `extension/test/onboarderResidualAllowlist.js:28` now lists
  `'swarmforge/scripts/finish_shift_lib.sh'`.
- D2: `backlog/active/BL-681-consolidation-never-drops-a-human-sentence.yaml`
  `acceptance:` now reads
  `specs/features/BL-681-consolidation-never-drops-a-human-sentence.feature`,
  which exists on disk; the `.feature.draft` path is gone.

## Complete review pass — doc content re-checked, no new defect

`git log --oneline c785a890f7..HEAD -- docs/` is empty: nothing under
`docs/` changed between my prior doc commit (`c785a890f7`, "Document
BL-574, BL-681, BL-762") and this merged tip. That commit already:

- Updated `docs/reference/Specification.MD`'s Governance section — the
  no-dropped-human-sentence invariant recorded as ratified Article 5.3
  (current "Last Updated" date set in that same commit).

Re-read against the now-fixed tree: the doc content is still accurate —
Article 5.3's ratification status and the feature file's content are
unchanged by this re-entry's delta (ticket YAML metadata, evidence files,
and a test allowlist entry only; confirmed via `git diff --stat
b2cd357f..0d2f948009` in the hardener re-pass evidence, no `docs/` or
`specs/features/BL-681-*` content change). No new documentation defect
found. NONE.

## Blocked checks

None.

## Disposition

Forwarding BL-681 to QA, naming this commit, so the full downstream gate
re-runs against the corrected lineage.

By documenter.
