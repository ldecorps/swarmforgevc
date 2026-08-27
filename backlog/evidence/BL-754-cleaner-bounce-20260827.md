# BL-754 cleaner bounce — 2026-08-27

**Routing:** coder (owns handoff commit selection and re-promotion evidence)

## Context

Three `git_handoff` parcels in batch `batch_20260827T053138Z_000001` name task
`BL-754` with commits `c2a0600800`, `86ff9ac0b5`, `953ce59b9b`. Sibling
re-promotions (BL-779, BL-1020, BL-1084) arrived as evidence-only coder passes;
BL-754 has no `BL-754-coder-pass-20260827.md` on the coder tip.

## Defects

**D1 — handoff (blame: coder):** Commits `c2a0600800`, `86ff9ac0b5`, and
`953ce59b9b` are acceptance-fixture **seed** commits (`git show --stat`: subject
`seed`, deletes `backlog/done/*` fixtures, adds `bl900-fixture.feature` and
`resolve_contract_steps.js`). `merge_and_process` on `c2a0600800` conflicts with
mass modify/delete of the live tree (entire repo deletion side). These are not
BL-754 implementation or re-promotion evidence.

- **Observed:** merge abort required; cannot integrate without destroying the
  worktree.
- **Expected:** evidence-only re-promotion commit like `1825d9ade7` / `f683aa4ad8`,
  naming verification of existing `required_stages_lib.bb` skip-reason surfacing.

**Remediation:** Re-handoff BL-754 with the correct 10-hex commit (evidence pass
or explicit no-change verification). Do not forward seed fixture commits.

## Local verification (implementation already in tree)

| check | result |
|---|---|
| `required_stages_test_runner.bb` | ALL PASS |
| `BL-754-stage-skip-reasons-never-silently-loses-a-stage.feature` | 5/5 |

Implementation from prior QA-approved land is intact; only the handoff commits
are wrong.

By cleaner.
