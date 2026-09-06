# BL-1440 — architect pass 2 (post-QA-bounce fix), 2026-09-06

Commit reviewed: 69cefa095c (`Merge cleaner 4d416fc5dc ... cleaner pass -
no defect, coder's bounce fix confirmed correct`), which carries the fix for
QA's bounce (`backlog/evidence/BL-1440-bounce-20260906.md`): coder commit
7da6c6145d adds `'check_constitution_doc_citations.sh'` to `INDEX_GUARDS` in
`extension/test/bl1252CommitGuardAggregationInvariants.property.test.js`.

Ancestry confirmed: my prior pass (332356da76) is an ancestor of this
commit (`git merge-base --is-ancestor 332356da76 69cefa095c`).

## Scope of this pass

Only one file changed since my prior architect pass: the property test's
`INDEX_GUARDS` fixture array (+3 lines, a comment and the guard filename).
No src/production code changed in this delta — the full architecture,
invariants, and required_wiring review from pass 1 (332356da76) still
applies unchanged; this pass re-verifies the specific defect QA bounced on
is actually fixed and checks nothing regressed.

## Gates run

| gate | result |
|---|---|
| `npm run compile` | PASS |
| `node out/tools/dependency-gate.js test/bl1252CommitGuardAggregationInvariants.property.test.js` | PASS — no forbidden edges |
| `node out/tools/co-change-report.js test/bl1252CommitGuardAggregationInvariants.property.test.js` | no pair at/above threshold (freq 3); all reported pairs at freq 1 |
| `npx vitest run test/bl1252CommitGuardAggregationInvariants.property.test.js --config vitest.properties.config.mjs` | **PASS 5/5** (previously 3/5 failing per QA bounce D1) |
| `required_wiring` (3 items) — guard chain call, docs/index.md link, `registerSteps` | PASS, all 3 present |

## Invariants re-check

Both declared invariants were already reviewed in pass 1 against production
behavior (the guard itself, the doc-citation resolver). This delta only
fixes the property test's own model to match that already-correct
behavior; it does not touch the guard, the resolver, or any article text.
Invariant 2 ("the commit guard refuses only on evidence... so the two can
never disagree") is exactly what this property file encodes end to end,
and it is now green — non-vacuous (previously failing against the same
production code, now passing after the fixture-only fix, no production
behavior changed).

## Verdict

NONE. No architecture violation, no invariant violation, no correctness
defect. Forward to hardener.
