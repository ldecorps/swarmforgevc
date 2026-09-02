# BL-1314 — architect pass

Date: 2026-09-02 · Verdict: **clean, forwarding to hardener**

## Received

Merged cleaner commit `649dc596f1` (clean sweep, no defect) onto architect's
tip as `5626aa723b`. Ancestry: `5a45f95bc1` (coder) → `0f659c6ace` (cleaner
merge) → `649dc596f1` (cleaner pass) → `5626aa723b` (this merge).

## Architecture checks

- Two-layer boundary, extension-host I/O ownership, webview storage, secrets:
  not touched by this parcel — no production TS changed.
- **Dependency gate** (`node extension/out/tools/dependency-gate.js`), both
  scoped to the parcel's one touched extension file
  (`test/bl1314InvariantTwoQaQuestionInvariants.property.test.js`) and
  full-repo: **PASSED, no forbidden edges** both times.
- **Co-change report** run against every changed production/test file
  (`invariant2_qa_definition_lib.sh`, `test_pipeline_code_on_main_guard.sh`,
  `test_invariant2_qa_definition_lib.sh`, the property test): every hit is
  frequency 1, below the default threshold (3) — no suspected coupling.
- The extraction from an inline assertion into
  `swarmforge/scripts/invariant2_qa_definition_lib.sh` is the correct shape
  per Design And Testability: the check becomes a pure predicate over two
  file paths, testable via fixtures rather than only the live tree.

## Invariants review (Article, BL-633/654)

Both declared invariants have executable property tests
(`extension/test/bl1314InvariantTwoQaQuestionInvariants.property.test.js`),
non-vacuous per the coder's evidence (probes A/B/C: break → red, restore →
green) — re-ran independently, see below. No spec-gap.

## Verification re-run (not taken on the coder's word)

- `bash swarmforge/scripts/test/test_invariant2_qa_definition_lib.sh` → 9/9 PASS.
- `bash swarmforge/scripts/test/test_pipeline_code_on_main_guard.sh` → exit 0, `ALL PASS`.
- `npx vitest run test/bl1314InvariantTwoQaQuestionInvariants.property.test.js --config vitest.properties.config.mjs` → 3/3 pass.
- `node specs/pipeline/cli.js specs/features/BL-1314-invariant-two-assertion-scoped-to-the-qa-question.feature` → 6/6 pass, no unmatched step.
- Wiring anchors: `suite-manifest.tsv:316` registers `test_invariant2_qa_definition_lib.sh` in the `standing` lane; `specs/pipeline/steps/index.js:920` registers `bl1314InvariantTwoQaQuestionSteps`. Both confirmed present.

## Ticket-less changes (not this parcel's, not swept)

`swarmforge/scripts/open_swarm_spy_router.sh` and
`swarmforge/scripts/spy_router_pane_label.sh` remain untracked in this
worktree — carried forward from coder/cleaner's own notes, not created or
staged by this pass.

## Verdict

No architecture violation, no invariant violation, no correctness defect
spotted. Forwarding to hardener.
