# BL-1314 — hardener pass

Date: 2026-09-02 · Verdict: **clean, forwarding to documenter**

## Received

Merged architect commit `e4c06a5565` (clean sweep, no defect) onto
hardender's tip as `f5a08bae94`. Ancestry: `5a45f95bc1` (coder) →
`649dc596f1` (cleaner) → `5626aa723b` (architect merge) → `e4c06a5565`
(architect pass) → `f5a08bae94` (this merge).

## Scope

`.sh` code — no wired mutation/CRAP/DRY tooling for this surface
(engineering.prompt Design And Testability: Babashka/bash gated only by its
own unit-test suite). No production TypeScript touched — CRAP/Stryker do
not apply. The coder's `test_invariant2_qa_definition_lib.sh` already
extracted the predicate into a pure function driven against fixture files
(cases 01–09), covering exactly the branch structure the ticket's
`qa_e2e_procedure` prescribes.

## Verification re-run (not taken on prior passes' word)

- `bash swarmforge/scripts/test/test_invariant2_qa_definition_lib.sh` → 9/9 PASS.
- `bash swarmforge/scripts/test/test_pipeline_code_on_main_guard.sh` → exit 0, `ALL PASS`.
- `node specs/pipeline/cli.js specs/features/BL-1314-invariant-two-assertion-scoped-to-the-qa-question.feature` → 6/6 pass, no unmatched step.
- `npx vitest run test/bl1314InvariantTwoQaQuestionInvariants.property.test.js --config vitest.properties.config.mjs` → 3/3 pass.
- `node extension/out/tools/dependency-gate.js` → PASSED, no forbidden edges.
- Wiring anchors re-confirmed: `suite-manifest.tsv:17` (relative) registers
  `test_invariant2_qa_definition_lib.sh` in the `standing` lane;
  `specs/pipeline/steps/index.js:920` registers
  `bl1314InvariantTwoQaQuestionSteps`.

## Hand-authored mutation spot-check (BL-638 fallback for a no-Stryker `.sh` surface)

The coder's own unit suite already enumerates every branch a hardener would
otherwise hand-mutate (positive-half drop, negative-half re-trigger,
third-question non-match, both-broken complete-inventory). To confirm the
suite is genuinely mutation-sensitive rather than merely branch-shaped, one
representative mutant was hand-applied and reverted:

- Mutant: `if (( ${#violations[@]} == 0 ))` → `!= 0` in
  `invariant2_qa_definition_lib.sh` (inverts the clean/dirty exit-code
  branch).
- Result: `test_invariant2_qa_definition_lib.sh` case 01 failed immediately
  (`FAIL: clean tree reported a violation`), confirming the suite kills a
  real code-level mutant, not just a fixture-shape mismatch.
- File restored byte-identical to the received tree (`git diff --stat`
  clean); full suite re-run to 9/9 PASS afterward.

No orphaned test/mutation processes: `pgrep -fl 'node --test|stryker'`
scoped to this worktree shows no matches.

## Hardening changes made

None — the parcel arrived already hardened (coder's fixture-driven unit
suite covers the full branch structure; architect independently re-ran
every gate). This is a no-op hardening pass on a real deliverable, not a
functional no-change: forwarding the received commit unchanged per the
Handoff rule.

## Ticket-less changes (not this parcel's, not swept)

`swarmforge/scripts/open_swarm_spy_router.sh` and
`swarmforge/scripts/spy_router_pane_label.sh` remain untracked in this
worktree — carried forward from coder/cleaner/architect's own notes, not
created or staged by this pass.

## Verdict

No coverage gap, no surviving mutant, no CRAP/DRY concern (no TS touched).
Forwarding to documenter.
