# BL-1096 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `a694bd2980` (per-path QA-import exemption via
`pipeline_path_import_exempt`; tip is no longer the sole anchor) into
`swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor a694bd2980 HEAD`.

## Checks run

1. **Shell unit** — `bash swarmforge/scripts/test/test_pipeline_code_on_main_guard.sh`:
   ALL PASS (incl. BL-1096 multi-hop / per-path / fresh-edit cases).
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1096-qa-import-exemption-anchors-per-path-not-the-merge-tip.feature`:
   7/7 pass.

## Cleanup performed

- Acceptance steps: memoize the full guard suite once per process so outline
  rows do not re-run a ~2s fixture seven times.
- Restored BL-925 invariant-2 wording on `pipeline_path_import_exempt`
  (shared `is_qa_ancestor.sh` predicate).

## Findings beyond that

NONE. Fail-closed on absent / bounced / undeterminable anchors; fresh edits
on top of imports still refuse only the edited path.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1096-qa-import-exemption-anchors-per-path-not-the-merge-tip`.

By cleaner.
