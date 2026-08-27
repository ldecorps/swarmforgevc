# BL-585 architect pass — 2026-08-19

## Reviewed commit
`a2ae8852cc9642040dbb33a35bf79f11c4a72064` ("BL-585: pipeline board renders
one ticket-column matrix, not pivoted per-ticket blocks", By coder,
forwarded unchanged by cleaner). No `invariants:` field on the ticket, so
no invariant-property-test authorship obligation applies (confirmed by
reading the ticket YAML directly).

## Checks run (complete inventory, not first-failure-stop)

1. **Module boundaries**: `extension/src/concierge/pipelineBoard.ts`
   imports only `roleTopicMapStore` and `swarm/rolePack` — pure formatting
   logic, no VS Code API, no I/O, no webview/host boundary crossing. Both
   render entry points (`renderPipelineBoardGridOnly` for the BL-526
   miniapp, `renderBodySections`/`renderPipelineBoardBody` for the
   Telegram pin) share the single `renderGridOnlySections` → `renderGridLines`
   path — confirmed by reading the call graph directly, no second layout
   path exists.
2. **Dependency-rule gate**: ran against
   `src/concierge/pipelineBoard.ts` + both test files: PASSED, no forbidden
   edges.
3. **Co-change report**: all flagged pairs are pipelineBoard.ts's normal,
   long-standing high-churn siblings (its own unit test, the shared step
   registry, `conciergeTick.ts`/`pipelineBoardSync.ts` as callers, and
   prior pipeline-board tickets BL-452/455/462/465/505/506/507/526) —
   nothing new or parcel-specific.
4. **Layout/width-budget formula read directly against the ticket's own
   pinned spec**: cell width computed over ALL candidate rows before
   slicing to the visible count (never circular); header/role lines use
   `padStartNbsp`; `maxVisibleGridColumns` derives `N` from
   `2 + N*(1+cellWidth) <= 30`, matching the ticket's worked example (7
   columns at cellWidth=3) exactly by hand calculation.
5. **"Both entry points, one renderer"**: verified structurally (item 1)
   rather than trusted from the commit message.
6. **Property Testing pass (my own ownership, independent of the ticket's
   absent `invariants:` field)**: assessed the new pure helpers this parcel
   adds (`maxVisibleGridColumns`, `padStartNbsp`, `renderGridLines`'s
   width/conservation behaviour). Found a genuine, non-hypothetical gap:
   the width-budget formula recomputes its column count from the WIDEST
   ticket id across all candidate rows, but both
   `extension/test/pipelineBoard.test.js` and the new acceptance feature's
   Scenario Outline 04 only pin it at 3 hand-picked active-ticket counts
   (3/7/10), all with 3-character-wide ids. This backlog already has
   4-digit ticket ids (BL-938, BL-939 landed this same session) — a case
   none of the fixed examples exercise, and the formula's behaviour changes
   materially once cell width isn't 3.
   - **Added** `extension/test/pipelineBoard.property.test.js`: "the
     rendered grid never exceeds the width budget and accounts for every
     active ticket, for any ticket-id-width mix" — generates 1-60 distinct
     ticket numbers (1-6 digits, so cell width varies) assigned round-robin
     across every real pipeline role, and asserts (a) no matrix line
     exceeds `PIPELINE_BOARD_GRID_MAX_WIDTH` — the ticket's own "no grid
     line is wider than 30 characters" wording, restated generically — and
     (b) conservation: shown-column count + dropped count always equals
     the total active-ticket count, for any N and any id-width mix.
     Black-box against the exported `renderPipelineBoardGridOnly`/
     `computePipelineBoard` surface, not a re-implementation of the
     internal formula.
   - **Verified non-vacuous in both directions myself**: (1) widened
     `maxVisibleGridColumns`'s effective budget by +10 in a scratch source
     edit — the width-bound half failed immediately with a fast-check
     shrunk counterexample ("32 chars exceeds ...=30"); reverted. (2)
     forced `droppedCount` to always `0` — the conservation half failed
     immediately ("Expected 5, Received 4"); reverted. Recompiled and
     reran after each revert to confirm the working tree and `out/` were
     back to clean/green.
   - Ran `npm run test:properties` (the correct, separate command per
     engineering.prompt's separation rule): 8/8 pass, including the 7
     pre-existing properties, confirming the coder's claim that none of
     them touch render/grid shape (independently spot-read the 7th,
     "a ticket held by any role always renders on a real column" — it
     exercises `computePipelineBoard`'s column-assignment, not
     `renderGridLines`, so the claim holds).
7. **Independently ran everything else, not just read it** (recompiled
   `npm run compile` first, twice more after my own scratch edits/reverts):
   - `extension/test/pipelineBoard.test.js`: 119/119 pass, matches the
     commit's claim exactly.
   - `extension/test/pipelineBoardSync.test.js`: 32/32 pass, matches the
     commit's claim exactly (unaffected, as claimed).
   - BL-585's own acceptance feature via `run_acceptance.sh`: 14/14 pass,
     matches the commit's claim exactly.
   - Step handler (`bl585PipelineBoardTicketColumnMatrixSteps.js`): reads
     no filesystem, holds no `mkdtempSync` fixture — confirmed by grep, no
     fixture-leak risk exists for this file at all.
8. **Out-of-scope check**: `git show --stat` on the reviewed commit lists
   only `pipelineBoard.ts`, its own unit test, the new step-handler file,
   and `index.js` — no below-grid section, link-list, or ordering logic
   touched, matching the ticket's own out-of-scope clause.

## Verdict
No architecture violation, no correctness defect. Added one property test
of my own (Property Testing ownership, BL-585 has no declared invariants so
this is additive coverage, not an invariant obligation), independently
verified non-vacuous in both directions I introduced it to check. Forwarding
to hardener.

By architect.
