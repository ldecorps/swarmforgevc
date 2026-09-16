# BL-1510 — QA hold, unowned red found during verification, 2026-09-16

BL-1510's own gates all pass (unit, property, acceptance, wiring — see
detail below). The parcel is held, not bounced, because the full property
and unit runs on the merged commit surface a red that has NO row in
`backlog/standing-reds.tsv` and no ticket that owns fixing it.

By QA.

## Parcel commit held

`00f7392bf35c4edb08694f49af4663cb2d239608` (BL-1510 documenter tip
`c546fbbb2a` merged into QA, then synced to `origin/main` at `012bb81731`).

## The unowned red

All three failures share ONE root cause: `nightClosingCeremonyRotateDocumenterFallback.test.js`
(introduced by hotfix `a27d082c2d`, already on `origin/main`, unrelated to
BL-1510) calls `fs.mkdtempSync` directly at line 29 instead of the shared
fixture-root helper, and (per the second guard) enumerates a live
repository directory.

Found via `grep -rl nightClosingCeremonyRotateDocumenterFallback backlog/`:
**BL-1591** already exists and names this exact file, but BL-1591's scope
is a stamp-off REVIEW of hotfix `a27d082c2d`'s ceremony/rotate-consult
behavior (human_approval firm: "the parcel changes no production file...
adds evidence, a feature, a step handler and, if the coder extends them,
TEST files only") — it does not itself register or claim ownership of
these three specific guard-test failures, and none of the three files
below has a row in `backlog/standing-reds.tsv`. Per Article 4.2 this is an
unowned red until the specifier either adds register rows under BL-1591's
scope or mints a dedicated owner.

### 1. `extension/test/liveRepoDerivationGuard.test.js` (unit lane)

```
AssertionError: every live-repository derivation must read a pinned fixture or record why it cannot:
  nightClosingCeremonyRotateDocumenterFallback.test.js: enumerates a live repository directory (cost grows with repo size)
```

### 2. `extension/test/tmpDirMigrationGuard.test.js` (unit lane)

```
AssertionError: expected zero raw mkdtemp call sites, found:
/home/carillon/swarmforgevc/.worktrees/QA/extension/test/nightClosingCeremonyRotateDocumenterFallback.test.js:29
```

### 3. `extension/test/bl1280MkdtempMigrationInvariants.property.test.js` (property lane, invariant 2)

```
AssertionError: Expected values to be strictly deep-equal:
+ actual - expected
+ [
+   {
+     file: '/home/carillon/swarmforgevc/.worktrees/QA/extension/test/nightClosingCeremonyRotateDocumenterFallback.test.js',
+     line: 29
+   }
+ ]
- []
```

All three re-run in isolation with the same result (deterministic, not
flaky): a structural property of the file (the raw `mkdtemp` call site,
the live-repo enumeration), not a timing-sensitive assertion.

## Detail — BL-1510's own gates (all green)

- Merged `c546fbbb2a` (documenter tip) into QA clean; then synced
  `origin/main` (`012bb81731`, bringing BL-1592's 4 new property-register
  rows) — `c546fbbb2a` remains an ancestor of HEAD.
- `npm run compile`: clean, no errors.
- `bash swarmforge/scripts/pre_qa_gate.sh BL-1510 HEAD`: `OK` (both
  `required_wiring` anchors resolve: `sendDocument` call site in
  `render-model-scoring-report.ts`, step handler registers).
- `npx vitest run test/renderModelScoringReport.test.js`: 36/36 passed.
- `npm test` (full unit suite): 620/622 files green; the 2 failing files
  are the unowned red above, not BL-1510's own files.
- `npm run test:properties` (full property suite): 408/409 files green;
  the 1 failing file is the same unowned red (invariant 2 only); the 2
  `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled errors are
  the BL-871 allowlisted benign artifact.
- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1510-*.feature`:
  4/4 scenarios passed.
- Manual e2e per `qa_e2e_procedure`: `node extension/out/tools/render-model-scoring-report.js . --no-send --out tmp/qa-report.md`
  produced a 9-row table (7 roles, 2 extra coder/architect model rows),
  `*` on every certified row, coordinator-exclusion footer present; diffed
  the `coder` rows against a fresh `bb model_steward_cli.bb role-matrix
  coder --include-uncertified` pull — both lines (`anthropic/claude-sonnet-5
  0.95`, `openai/gpt-5.3-codex 0.92`) present with matching evidence refs.
  Scratch file removed after.
- Standing-red register checked (`backlog/standing-reds.tsv`, 9 rows after
  sync): all 9 name an open ticket (BL-1588, BL-1589, BL-1592); none of
  BL-1510's own files appear.
- Prior-stage evidence (architect/cleaner/hardender/documenter) all
  recorded explicit NONE.
- No stragglers before or after (`pgrep -fl 'node --test|stryker'`
  checked; unrelated processes found belonged to the hardener's own
  detached `stryker.bl1510.config.json` mutation run in
  `.worktrees/hardender` and the coder's own property-file repros in
  `.worktrees/coder` — neither is orphaned, neither is mine).

## Expected vs observed

Expected: BL-1510's own gates green AND no unowned red on the commit being
approved. Observed: BL-1510's own gates are green, but the merged commit
surface carries a pre-existing, unregistered, deterministic red from
hotfix `a27d082c2d` — Article 4.2 withholds approval until it is owned.
