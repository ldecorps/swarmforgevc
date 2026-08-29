# BL-581 — QA Bounce — 20260829

## Verification order followed
- `qa-sibling-check.js status --ticket BL-581` → `VERIFY BL-581` (exit 0, no open
  deferral). Full pass performed below.

## Full inventory (Article 4.4 — one bounce, complete checklist)

### D1 — acceptance scenario 4 fails: buggy step wiring, not buggy content

1. **Failing command**:
   `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-581-documenter-owns-diagram-currency.feature`
2. **Commit hash tested**: `a60c44ce5f` (documenter's own commit, "BL-581: add
   step handlers for diagram currency governance checks"), verified as an
   ancestor of the merge commit under review (`82e115af5`), and the merge's
   content for every BL-581-touched file is byte-identical to `a60c44ce5f`
   (`git diff a60c44ce5f 82e115af5 -- <touched files>` is empty — no hunks
   dropped in the merge-up).
3. **First error excerpt**:
   ```
   not ok 4 - DIAGRAM_FILES and the constitution diagram list match
     error: 'Scenario "DIAGRAM_FILES and the constitution diagram list match"
       failed at step "Then every diagram in DIAGRAM_FILES has an entry in the
       constitution": Diagram architecture.mmd in DIAGRAM_FILES but not in
       constitution'
   ```
4. **Failure class**: `acceptance`.
5. **Expected vs observed**: Expected all 4 scenarios green — the underlying
   constitution content is correct (verified by hand: `DIAGRAM_FILES` in
   `extension/src/tools/render-briefing-diagrams.ts` lists exactly
   `architecture.mmd`, `swarm-flow.mmd`, `handoff-flow.mmd`,
   `front-desk-flow.mmd`, and `local-engineering.prompt`'s Diagrams section
   lists the same four with change-triggers). Observed: scenario 4 throws
   because its own step wiring never populates the context it reads.

**Root cause** (`specs/pipeline/steps/bl581DocumenterOwnsDiagramCurrencySteps.js`):
scenario 4's `Given` step `"the diagram list from local-engineering.prompt's
Diagrams section"` only does `ctx.diagramsSectionList = ctx.diagramsSection`
— it never reads/parses the file itself. `ctx.diagramsSection` is populated
elsewhere only by the *different* step text `"local-engineering.prompt's
Diagrams section is read"` (used in scenarios 2 and 3), which scenario 4 never
invokes. `runtime.js` gives every scenario a fresh `context = {}`
(`specs/pipeline/runtime.js:19`), so in scenario 4 `ctx.diagramsSection` is
`undefined` when the `Then` steps run `assert.match(diagramsSection, ...)`,
and the assertion fails — deterministically, not flaky (reran twice, same
result).

**Remediation pointer**: `specs/pipeline/steps/bl581DocumenterOwnsDiagramCurrencySteps.js`,
the `"the diagram list from local-engineering.prompt's Diagrams section"` step
handler — it needs to actually read+parse `local-engineering.prompt` (the same
work the `"...is read"` step already does) into `ctx.diagramsSection`/`ctx.diagramsSectionList`,
not alias an unset context key.

**Blamed role**: `documenter` — this file was authored in the documenter's own
commit `a60c44ce5f` ("completing the documenter pass for BL-581"); the defect
is entirely inside that commit's own new code, not something an earlier stage
handed off broken.

### Rest of the checklist — no other defects found

- **qa_e2e_procedure items 1–3** (`01_roles.md` 1.7 names diagram currency +
  same-parcel wording; `local-engineering.prompt` lists all four diagrams with
  distinct change-triggers; no count-encoding wording) — all PASS, confirmed
  both by direct read and by acceptance scenarios 1–3 (all green).
- **Registry match (item 4), by hand**: `DIAGRAM_FILES` (4 entries) and the
  constitution's Diagrams list (4 entries) match exactly — content is correct;
  only the executable check is broken (D1 above).
- **Wiring**: step file is registered in `specs/pipeline/steps/index.js:561`
  and does execute (3 of 4 scenarios run and pass) — not an unwired-entirely
  miss, a wiring **bug** within the file that did get wired.
- **Full unit suite** (`cd extension && npm test`): 37 files / 17 tests red.
  Cross-checked every failing file against BL-581's own changed-file list
  (`01_roles.md`, `local-engineering.prompt`,
  `backlog/active/BL-581-...yaml`, `specs/features/BL-581-...feature`,
  `backlog/evidence/BL-581-*.md`, `specs/pipeline/steps/bl581...Steps.js`,
  `specs/pipeline/steps/index.js`) — zero overlap. Every failing file matches
  an already-tracked standing-debt class corroborated the same day in
  `backlog/evidence/BL-1244-qa-pass-unrelated-reds-20260829.md` and
  `backlog/evidence/QA-standing-red-corroboration-20260828.md`: `require('node:test')`
  vs Vitest collection ("No test suite found", BL-1220), `deps.checkOrphanedAuthoredDocs
  is not a function` (BL-1221), whole-tree guard reds
  (`constitutionDocCitations`, `tmpDirMigrationGuard`, `tempDirTrapGuard`,
  `socketFixtureShortRootGuard`, `liveRepoDerivationGuard` — confirmed the
  `docs/deprecated/` citation gap predates this ticket's diff), plus the
  previously-reported-untracked-but-not-blocking set from BL-1244
  (`backendSwitch`, `backlogDashboard`, `operatorRuntimeBbFixtureClosure`,
  `pilotAcceptanceGateCli`, `telegramClient`, `telegramCursorOperatorExec`,
  `backfillEpicTopicIconsCli`/`backfillStandingTopicIconsCli`). Not
  re-reported per BL-1063 doctrine.
- **Property suite** (`npm run test:properties`): 26 files / 16 tests red,
  same posture — cross-checked, zero overlap with BL-581's files, matches
  known classes (`BL-1012`, `BL-654` family via `bl1113`/`bl1115`/`bl1136`,
  `bl632`, `BL-1221`'s `deps.checkOrphanedAuthoredDocs`, `BL-1220`'s
  collection-error class, `BL-1262` for the `selfHealTelemetry` gitignore
  invariant). Only allowlisted unhandled error seen (`[vitest-worker]: Timeout
  calling "onTaskUpdate"`, BL-871).
- **Ancestry**: `f3c929813e` (cleaner), `b09d1e64e` (feature file),
  `fcd360af2` (architect pass), `6df7d481f` (hardener) are all confirmed
  ancestors of `a60c44ce5f` (documenter) — no wrong-commit risk (BL-336
  shape checked and clear).
- **Orphaned processes**: `pgrep -fl 'node --test|stryker'` checked before and
  after the full run; the only matches were the `bash -c` invocations of the
  pgrep command itself (self-match, confirmed dead via `ps -p`), no real
  stragglers.

## Disposition

Bounce to **documenter** (owns the fix — the defect is entirely inside the
documenter's own new step-handler file, D1 above). Not a spec gap, not a
coder/cleaner/architect/hardener defect — the constitution content those
stages produced is correct.

By QA.
