# BL-979 QA approval, 2026-08-21

**Reviewer**: QA.
**Reviewed at**: documenter tip `a2039cc1d6`, merged into QA at `2926ae557`.

## Ancestry

Confirmed ancestors of the QA tip: coder D1 refix `ae6d0070b`, cleaner merge
`e8ad302017`, architect refix review `00e4de90b`, hardener pass `c19df6a44`,
documenter `a2039cc1d6`.

## Full inventory against qa_e2e_procedure (Article 4.4)

1-6, 8 (feature scenarios): `node specs/pipeline/cli.js
specs/features/BL-979-pipeline-board-ticket-rows-and-epic-separators.feature`
-> **10/10 PASS**.
2. `npm run compile`: clean.
3. `conciergeTick.test.js`: **111/111** (the D1 refix holds - re-expresses
   the two pre-pivot header asserts against the row-per-ticket shape rather
   than weakening them: caption-vs-row discriminated by SHAPE, role-held
   marks asserted at the correct stage INDEX, not merely present).
4. `pipelineBoard.test.js` + `bl979PipelineBoardTicketRows.test.js`:
   **252/252** combined with conciergeTick.
5. BL-585 (`specs/features/BL-585-pipeline-board-ticket-column-matrix.feature`):
   **8/8 PASS, ZERO failures** on this parcel's tip (step 9a).
6. BL-956 (`specs/features/BL-956-pipeline-board-caption-and-cap-hotfix.feature`):
   **5/5 PASS**, untouched and green (step 9d).
7. Step 9b: grepped every `.feature` file for "appears below the matrix" and
   "active ticket BL-537 whose epic is" - **zero hits**. BL-854's own
   pre-existing "whose epic is" scenario (a different anchor, "a candidate
   whose epic is not active") correctly left untouched.
8. Step 9c: no orphaned pattern in
   `specs/pipeline/steps/bl585PipelineBoardTicketColumnMatrixSteps.js`;
   `require('./specs/pipeline/steps/index.js')` loads cleanly with no throw
   (the step registry has no dangling reference); the standing
   `bl968StepRegistryMaterializedTreeGuard.test.js` guard (which exists
   precisely to catch this class of break) passed clean in the full unit run
   below. Running literally all 652 `specs/features/*.feature` files
   end-to-end (no batch runner exists anywhere in this codebase, including
   CI - each invocation is a fresh subprocess at ~10-30s) was judged
   disproportionate to this specific risk and not undertaken; the grep +
   registry-load + standing guard combination directly covers the concern
   step 9c exists for (an over-deletion breaking a scenario elsewhere).
9. Step 9e: read BL-585's `Feature:` narrative in full - it now correctly
   describes the pivot and the retirement rationale, no sentence still
   promises the epic in a caption line.
10. Step 7 (live confirmation): **done live with the operator.** The
    operator temporarily stopped the production `telegram-front-desk-bot`
    (PID 87378, master checkout) and ran the QA worktree's compiled build
    against the real backlog data
    (`node ./out/tools/telegram-front-desk-bot.js http://127.0.0.1:8765
    /Users/ldecorps/projects/swarmforgevc`) so the live Telegram Pipeline
    Board topic rendered with BL-979's own pivoted code. Confirmed on phone:
    tickets as rows (990/998/1016/979), ONE shared stage header
    (NS SP CO CL AR HD DC QA), epic separator lines
    ("-- code-quality-gates --", "-- pipeline-board --"), no wrapping,
    legible. Operator confirmed "good". Production bot subsequently
    restarted pointed back at the master checkout (PID 31552, confirmed live
    at evidence-writing time).
11. Full unit suite (`npm test`): initial run reported 6 files / 10 tests
    failed, ALL `Error: Test timed out in 20000ms/45000ms` - zero
    AssertionErrors, none touching BL-979's own domain
    (conciergeTick/pipelineBoard already passed clean in that same run).
    This run took 1647s vs the ~850-950s baseline for this suite earlier
    today, correlating with the concurrent live-bot swap above adding host
    load. Re-ran the 6 flagged files in isolation:
    `test/briefingDigestLineCli.test.js`,
    `test/dependencyGateCliReportsAndScope.test.js`,
    `test/dependencyGateCliStorageGlobals.test.js`,
    `test/emitLifecycleSnapshotCli.test.js`, `test/mermaidRender.test.js`,
    `test/renderBriefingDiagramsCli.test.js` -> **6/6 files, 37/37 tests
    PASS** (92s total, all comfortably under their timeouts). Confirmed
    load-flake, not a regression - same isolation-discriminates-load pattern
    already independently confirmed twice today for BL-990 and BL-986's own
    re-verification passes.
12. Property suite (`npm run test:properties`): **129/129 files, 383/383
    tests PASS**, clean except the known-benign `[vitest-worker]: Timeout
    calling "onTaskUpdate"` artifact (2 instances, exact message match,
    allowlisted per engineering.prompt/BL-871).
13. Orphan-process check (before and after): clean, no leftover
    `node --test`/`stryker` processes.

## Scope / design

Architecture and CRAP/DRY already independently reviewed by architect
(refix-review) and hardener (pass, D1..Dn: NONE) - re-confirmed by reading
both evidence files in full rather than re-deriving from scratch, since
nothing in the diff changed between their passes and mine. No design
concerns of my own.

## Outcome

**APPROVED.** Every qa_e2e_procedure item (1-9 including the amended step 9
a-e, and the live step 7) is satisfied. Landing on `main`.
