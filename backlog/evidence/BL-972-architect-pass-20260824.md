# BL-972 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `198cdbac0f` (on coder `2c7d557354`) into
`swarmforge-architect`. Ancestry confirmed.

## Scope

Pre-QA ancestry: subject-token recall unchanged; blocking requires path
overlap with parcel evidence (`parcel-paths-for-cited` + candidate
`diff-tree -m` paths). Subject-only → warning; `abandoned_commits` still
exempts. Cleaner: shared `git-name-only-paths` / merge-base main refs.

## Architecture

- Matches approval (path evidence v1; content deferred) and engineering
  guardrail already landed.
- Invariant: name-only never blocks; path overlap still blocks true
  dropped work; abandoned always exempts.
- Recall preserved as warnings (not silence). Pure evaluate helpers
  (`paths-overlap?`, `stranded-ticket-commit?`, `ancestry-verdict`) keep
  the decision surface testable; gather stays the thin git IO layer.
- Wiring half untouched. Diff-content matching correctly out of v1.

## Gates

| Gate | Result |
|---|---|
| Unit (`pre_qa_gate_lib_test_runner.bb`) | ALL PASS |
| Acceptance (BL-972 feature) | **3/3** |
| Stamp-off (BL-1113) | **9/9** |
| Dep-gate | N/A (babashka/APS; no `extension/src` production) |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-972-pre-qa-gate-blocks-on-evidence-not-subject-mentions`.

By architect.
