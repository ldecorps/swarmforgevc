# BL-1314 — documenter pass

Date: 2026-09-02 · Verdict: **NONE — clean sweep, forwarding to QA**

## Scope reviewed

BL-1314 scopes the BL-925 invariant-2 pin in
`test_pipeline_code_on_main_guard.sh` to the QA question (the Babashka half
was grepping `handoffd.bb` for ANY `merge-base --is-ancestor` call; now both
halves match only calls against `swarmforge-QA`, via the new
`swarmforge/scripts/invariant2_qa_definition_lib.sh`). `handoffd.bb` and
`check_pipeline_code_on_main.sh` are unchanged, per the human ruling (option
1) recorded in `backlog/evidence/BL-1314-specifier-ruling-invariant-2-overbroad-20260831.md`.

Reviewed: coder (`5a45f95bc1`), cleaner (`649dc596f1`), architect
(`e4c06a5565`), hardener (`e301688d42`) evidence files and the full diff
(`invariant2_qa_definition_lib.sh`, `test_invariant2_qa_definition_lib.sh`,
`test_pipeline_code_on_main_guard.sh`, property test, acceptance feature +
step handler, `suite-manifest.tsv` registration).

## Doc impact assessment

- No user-visible behavior, command, setting, or flow changed — this is an
  internal pre-commit/pre-merge guard test assertion, not product surface.
- `docs/reference/BL-632-commit-time-guard-refuses-pipeline-code-on-main.md`
  is the one living doc that describes this guard's invariant-2 test
  (Testing section). Checked: its wording — "an invariant-2 wiring check
  that both `check_pipeline_code_on_main.sh` and `handoffd.bb` call
  `is_qa_ancestor.sh` rather than a second inline `git merge-base
  --is-ancestor`" — remains true after the fix; it never claimed the old
  over-broad (any-ref-pair) matching behavior, so it needs no correction.
  It does not name `invariant2_qa_definition_lib.sh` specifically, and
  adding that level of implementation detail is not required for this
  doc's altitude.
- No diagram (`architecture.mmd`, `swarm-flow.mmd`, `handoff-flow.mmd`,
  `front-desk-flow.mmd`) depicts test-assertion internals; none of their
  change-triggers fired.
- No retirement: nothing moved to `docs/deprecated/`.

## Verdict

No documentation defect. Forwarding the hardener's tip unchanged to QA.

By documenter.
