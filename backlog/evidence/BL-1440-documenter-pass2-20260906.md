# BL-1440 — documenter pass 2, 2026-09-06

Commit reviewed: 27f9589a47 (hardener pass 2 — bounce fix confirmed).

## Context

QA bounce D1 (`backlog/evidence/BL-1440-bounce-20260906.md`): the coder's
guard wiring (`run_commit_guards.sh`) omitted
`check_constitution_doc_citations.sh` from `INDEX_GUARDS` in
`bl1252CommitGuardAggregationInvariants.property.test.js`, a defect owned
by the coder's own wiring commit, outside documenter domain. Coder added
the one array entry; cleaner and architect confirmed no further defect;
hardener re-verified independently (property suite 5/5, was 3/5;
constitution unit test 6/6; BL-1440 acceptance 4/4 unaffected).

## Documentation review

No doc-owned file changed in this delta (a property-test fixture array
entry only). Re-checked that my pass-1 documentation review
(`BL-1440-documenter-20260906.md`) still holds against the fixed tree:
`docs/deprecated/README.md`, both Art Director design docs, and the
`docs/index.md` link are unaffected by this bounce fix and remain
correct.

## Re-verification (re-ran, all green)

| check | result |
|---|---|
| `cd extension && npx vitest run test/bl1252CommitGuardAggregationInvariants.property.test.js --config vitest.properties.config.mjs` | 5/5 |
| `cd extension && npx vitest run test/constitutionDocCitations.test.js` | 6/6 |
| `node specs/pipeline/cli.js BL-1440-....feature` | 4/4 |

## Verdict

No documentation defect. Bounce fix confirmed outside documenter domain.
Forwarding to QA.
