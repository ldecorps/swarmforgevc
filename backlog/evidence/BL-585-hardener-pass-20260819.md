# BL-585 hardener pass — 2026-08-19

## Reviewed commit
`643d66c9fd` ("Merge architect BL-585 ... into hardender", architect
clean-pass, added a property test — see `backlog/evidence/BL-585-architect-pass-20260819.md`).

## Checks run (complete inventory, not first-failure-stop)

1. **Bounce history check** (BL-340): `git rev-list --left-right --count
   main...origin/main` → `12 0` (local `main` ahead, both agree). No prior
   bounce for BL-585 on either ref.
2. **Leftover process/fixture check before starting**: no stray
   `node --test`/`stryker`/`vitest` in this worktree; no leaked fixture
   tmux sockets. One live `node --test` belongs to `.worktrees/coder`
   (different worktree, not mine — left alone).
3. **Unit suite**: `npx vitest run test/pipelineBoard.test.js
   test/pipelineBoardSync.test.js` — 151/151 pass, both before and after my
   own refactor below.
4. **Property test** (this parcel's own file, run in isolation — the full
   `npm run test:properties` command hits an unrelated slow property
   (`onboarderLauncherPidGuard`, ~60s+ under today's load) that exceeds this
   sandbox's ~120s command cap regardless of backgrounding; ran the
   parcel-relevant file directly against the same `vitest.properties.config.mjs`):
   `test/pipelineBoard.property.test.js` — 8/8 pass (7 pre-existing +
   architect's new width/conservation property), before and after refactor.
5. **Acceptance**: `run_acceptance.sh specs/features/BL-585-pipeline-board-ticket-column-matrix.feature`
   — 14/14 pass, before and after refactor. Feature has `Scenario Outline`s.
6. **DRY** (`jscpd --config .jscpd.json src/concierge/pipelineBoard.ts`): 3
   clones found, all pre-existing plain/HTML render-function duplication
   (`renderParkedSection`/`renderParkedSectionHtml`, etc.) at line ranges
   outside this ticket's diff (confirmed via `git diff 090e3b48b..HEAD` hunk
   boundaries: only `renderGridLines` and its new helpers changed, lines
   ~607-673 of the new file; clones sit at 450/861, 681/877, 890/913).
   Explicitly out-of-scope per the ticket's own `out_of_scope:` clause
   ("below-grid sections ... unchanged"). Not touched.
7. **CRAP** (`npm run coverage` scoped to the parcel's test files +
   `node scripts/crapReport.js src/concierge/pipelineBoard.ts`, against
   `src/*.ts` per the CRAP-scoping rule): `renderGridLines` — the one
   function this ticket actually rewrote — flagged at
   `complexity=8 coverage=100% CRAP=8.00`, over the <=6 threshold. All
   other flagged functions in the file (`renderParkedSectionHtml`,
   `composePipelineBoardHtml`, `buildPipelineBoardHtml`,
   `renderListSectionHtml`, `renderParkedSection`, `renderBodySections`,
   `renderGridTapLinesHtml`, `listSectionTicketIds`, `renderListSection`,
   `formatCollapsedEpicLineHtml`) are pre-existing debt this ticket's diff
   never touched — confirmed by the same hunk-boundary check as DRY above.
   **Fixed**: split the header/mark-row loops out of `renderGridLines` into
   a new `renderGridMatrixLines` helper (behavior-preserving, mirrors the
   file's own established `buildGridRows`/`buildParkedEntries` CRAP-split
   comment pattern) — `renderGridLines` now carries the `if(empty)`/caption-
   loop/`if(dropped)` branches only, `renderGridMatrixLines` carries the
   header-loop/column-loop/inner-loop/ternary branches. Re-measured after
   recompile: `renderGridLines` no longer appears in the flagged list at
   all; `renderGridMatrixLines` is `complexity=5 coverage=100% CRAP=5.00`.
   Re-ran unit (151/151), property (8/8), and acceptance (14/14) suites
   after the refactor — all still green, confirming it changed no behavior.
8. **Mutation (both mechanisms) — DEFERRED, host busy**: BL-149 cooldown
   gate (`mutation_cooldown_gate.bb`, `SWARMFORGE_MUTATION_GATE_FORCE_CORES=4`
   on this macOS host per the standing workaround) returned `skip-busy`
   on every check across this pass (`load_avg` oscillated 7.2-14.4 against
   a `busy_threshold` of 8, on a host at `uptime` load averages 7-25 the
   whole session — 5/15-min averages stayed elevated (12-25) even when the
   1-min figure briefly dipped under 8). Per the load rules binding every
   mutation runner (Stryker AND Gherkin BL-113 alike), and consistent with
   this same worktree's own BL-915 pass minutes earlier under the same
   conditions: BOTH Stryker mutation and BL-113 Gherkin acceptance-mutation
   (the feature has `Scenario Outline`s, so BL-113 applies) are deferred to
   the next quiet-host pass rather than risking a dry-run crash / flat-CPU
   stall against this sandbox's own ~120s command cap. Neither ran; neither
   is recorded as passed. This is the office-hours bypass, not a bounce —
   the parcel is not stalled on it.
9. **Housekeeping**: found and deleted 3 orphaned `bl868-fixture-*.property.test.js`
   files in `extension/test/` left by this pass's own killed
   `test:properties` attempts (the documented "a killed property/mutation
   run leaks its fixture" trap) — confirmed by mtime match and content
   (the known `BL868_LEAK_PROBE_*` env-set fixture body) before deleting.
   Not committed; deleted before this evidence commit.

## Outcome
D1 (only item): `renderGridLines` CRAP 8.00 → fixed via behavior-preserving
split (`renderGridMatrixLines`), verified green. Mutation (Stryker + BL-113)
BLOCKED BY host load (BL-149 gate `skip-busy` throughout); deferred, not
skipped-silently — owed on the next quiet-host pass, same class as BL-915's
and the systemic gap tracked in BL-941/BL-942.

Forwarding to documenter.

By hardener.
