# QA standing-red corroboration + one new item — 2026-08-28

While verifying BL-1192 (pre-handoff task-scope gate, approved and landed
`27eadb5dad`), ran both `npm run test` and `npm run test:properties` in full
against the merged QA tip. Recording this so the specifier's 2026-08-28
disposition note (`specifier-disposition-qa-standing-red-note-20260828.md`,
BL-1220/BL-1221/BL-1206) isn't re-diagnosed from scratch by the next role
that hits the same red.

## Corroborated, not new

- Unit lane (`npm run test`): 38 files failed. Cross-checked every failing
  file against BL-1192's own merge diff (`git diff --name-only
  74985e62c..c277b013c4`) — none were touched by this parcel. Failure
  signatures match BL-1220's "No test suite found" (`node:test` vs Vitest
  collection) class, BL-1221's `deps.checkOrphanedAuthoredDocs is not a
  function` class, and the specifier's explicitly-named repo-hygiene reds
  (`constitutionDocCitations`, `tmpDirMigrationGuard`, `tempDirTrapGuard`,
  `socketFixtureShortRootGuard`, `liveRepoDerivationGuard`), plus an
  ENOTEMPTY tmp-fixture race on `telegramCursorOperatorExec.test.js`
  consistent with this host's known /tmp fixture-census bloat (BL-1039
  lineage).
- Property lane (`npm run test:properties`): 15 failed tests + several
  whole-file "No test suite found" collection errors (~30 files). Same
  story: `bl1220`/`bl1221`-class collection gaps, plus already-evidenced
  `BL-654` stamp-off invariant reds (`bl1113`, `bl1115`, `bl1136`),
  `BL-1230`/`BL-1246` (`nestedGitRepoGuard`), `bl1012`, `bl632`. None of
  these files appear in BL-1192's merge diff either.

## New — not found by grep

`test/bl593MutationRunTelemetry.property.test.js` — `property: completed
records always carry load-bearing scope total and incremental` fails
deterministically (ran isolated, twice, same counterexample both times):

```
Error: mutation run record requires a non-empty scope
 at requireLoadBearingMeta src/mutation/mutationRunTelemetry.ts:40:11
 at buildMutationRunRecord src/mutation/mutationRunTelemetry.ts:56:3
```

`grep -rli "bl593\|mutationRunTelemetry\|requireLoadBearingMeta" backlog/`
finds only BL-593's own (done) ticket and unrelated QA-pass evidence for
other tickets — no open ticket covers this. Not touched by BL-1192's diff;
not blocking BL-1192's approval. Leaving disposition to the specifier
rather than minting — same posture as the rest of this note.

By QA.
