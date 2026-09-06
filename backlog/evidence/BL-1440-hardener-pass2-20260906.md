# BL-1440 — hardener pass 2 (post-bounce-fix), 2026-09-06

Commit reviewed: c9f4e50d5a (architect pass 2, confirms coder's QA-bounce
fix). Ancestry confirmed: my prior pass (d143fc2ff7) is an ancestor of
this commit.

## Scope of this pass

Only one file changed since my prior hardener pass (d143fc2ff7): a
3-line addition (comment + one array entry,
`'check_constitution_doc_citations.sh'`) to the hand-enumerated
`INDEX_GUARDS` list in
`extension/test/bl1252CommitGuardAggregationInvariants.property.test.js`,
fixing the QA bounce (`backlog/evidence/BL-1440-bounce-20260906.md`,
D1). This is a property-test fixture data entry, not new production
logic — no new mutation surface, and property-test files are
deliberately kept out of the coverage/mutation/CRAP/DRY commands
(engineering.prompt's separation rule), consistent with the cleaner's
and architect's own assessment of this same delta.

## Re-verification (all green)

| check | result |
|---|---|
| `npx vitest run test/bl1252CommitGuardAggregationInvariants.property.test.js --config vitest.properties.config.mjs` | 5/5 (was 3/5 failing per QA bounce) |
| `npx vitest run test/constitutionDocCitations.test.js` | 6/6 |
| `node specs/pipeline/cli.js BL-1440-....feature` | 4/4, unaffected by the bounce fix |
| leftover `/tmp/bl1440-fixture-*` | 0 |
| orphaned `node --test`/stryker processes | none |

Everything from my pass-1 evidence
(`backlog/evidence/BL-1440-hardener-pass-20260906.md` — the BL-113
Gherkin mutation run over scenario 03's Outline, the accepted
equivalent mutant, the whole-tree standing-guard sweep) is unaffected:
none of those files changed in this delta.

## Verdict

No defect. Bounce fix confirmed correct and complete. Forwarding
unchanged to documenter.
