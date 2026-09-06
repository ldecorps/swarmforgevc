# BL-1440 — cleaner pass (post-bounce-fix), 2026-09-06

Commit reviewed: 7da6c6145d (`BL-1440: add check_constitution_doc_citations.sh
to INDEX_GUARDS`) — the coder's fix for QA's bounce
(`backlog/evidence/BL-1440-bounce-20260906.md`, D1). Confirmed ancestor via
`git merge-base --is-ancestor 7da6c6145d HEAD`.

## Change reviewed

Three-line addition to `extension/test/bl1252CommitGuardAggregationInvariants.property.test.js`:
adds `'check_constitution_doc_citations.sh'` to the hand-enumerated
`INDEX_GUARDS` fixture list, exactly matching the bounce's remediation
pointer and the existing BL-1428 entry's comment style.

## Gates run

| gate | result |
|---|---|
| `npm run compile` | PASS |
| `npx vitest run test/bl1252CommitGuardAggregationInvariants.property.test.js --config vitest.properties.config.mjs` | PASS 5/5 (all three previously-failing properties now green) |
| `npx vitest run test/constitutionDocCitations.test.js` | PASS 6/6 |
| `npx vitest run` (full unit suite) | PASS 610 files / 10283 tests |

## Cleanup assessment (Article 1 cleaner duties)

- Change is a single-array-entry addition to an existing hand-enumerated
  list, following the established comment convention (ticket id, join
  date, one-line reason) used by every prior entry (BL-1303, BL-1385,
  BL-1395, BL-1428). No duplication, no structural issue, no coverage gap:
  the line is exercised by the same five properties that were failing
  before it existed.
- No CRAP/DRY/mutation concern — the diff is a data-list entry, not new
  logic; no new mutation sites introduced (BL-485 mutation-site-count tool
  is for files with new/changed code paths, not a static array literal
  extension).

## Verdict

NONE — no defect found in the coder's bounce fix. Ready to forward to
architect.
