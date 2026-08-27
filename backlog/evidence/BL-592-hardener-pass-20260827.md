# BL-592 hardener pass — 2026-08-27

## Reviewed commit

`9920ff2826` (architect pass, forwarding a byte-identical implementation
to the original coder commit `e5cf2a3af`, plus the D1 fixture-cleanup fix
on the step handler). Merged into hardender at this commit.

## Gates

| Gate | Result |
|---|---|
| Compile (`tsc -p ./`) | PASS |
| Unit (`docsTree.test.js`, `pwaDocsExplorer.test.js`, `pwaLocale.test.js`) | 98/98 → **114/114** after this pass's additions (independently re-run) |
| Property (`bl592SpecTreeEpicTierInvariants.property.test.js`, scoped) | 2/2 PASS |
| Acceptance (`run_acceptance.sh`) | 8/8 PASS |
| Fixture leak count | 0 leaked tmp dirs after all runs (mkTmpDir helper) |
| Whole-tree standing guards (6 `*Guard*.test.js` files touching `extension/test/`) | 4 pre-existing failures, **none reference any BL-592 file** — see below |
| CRAP (scoped to touched files) | see below |
| DRY (`jscpd`, scoped) | 0 clones involving any touched file |

## Two real coverage gaps found and closed (hand-authored, since Stryker
## could not run — see below)

**1. `extension/src/bridge/specTreeUiHtml.ts` — the entire inline
`<script>` (Milestone → Epic → BL item → Gherkin drill-down, ~180 lines of
navigation logic) had ZERO test coverage of any kind.** This is the
standing "bridge `getXxxUiHtml()` inline `<script>` is invisible to
Stryker" class (`stryker.config.json`'s `mutate: ["out/**/*.js"]` never
descends into a template-literal string). No prior test file existed for
it — only the property test (which exercises `computeDocsTree`, not the
webview). Added `test/specTreeUiHtml.test.js` (10 tests, JSDOM +
`extractInlineScript` harness, mirroring `epicDrilldownUiHtml.test.js`).
Hand-mutated the compiled `out/bridge/specTreeUiHtml.js` and confirmed
kills for: ticket-count summed-across-epics, epic label (title vs.
epicKey fallback), `findEpic`'s epicKey selector, `findMilestone`'s name
selector, `findTicket`'s id selector. One real gap found and closed during
this sweep: my first draft of the multi-epic test only ever drilled the
FIRST epic in a milestone's array (`epics[0]`) — a `findEpic` mutant that
always returned `epics[0]` survived. Added a dedicated
"drilling into the SECOND epic" test (the standing "exercise a selector
with 2+ concurrent candidates" discipline) before it was caught.

**2. `extension/src/bridge/bridgeServer.ts`'s new route wiring
(`isSpecTreePath`, `isSpecTreeStatePath`, their `QUERY_TOKEN_ELIGIBLE_PATHS`
entry, and the `buildJsonRoutes` `compute: () => computeDocsTree(...)`
entry) had ZERO end-to-end coverage over a real HTTP server.** The
architect's required_wiring check confirmed these by READING the source;
nothing anywhere called the real `startBridge()` and hit `/spec-tree` or
`/spec-tree-state` over HTTP (grepped: only my own new test file mentions
`spec-tree` at all). Added `test/specTreeBridge.test.js` (4 tests, real
`startBridge()` + real `fetch()` against a real port, same
`withBridge`/try-finally pattern as `epicReorderBridge.test.js`). Confirmed
by hand-mutation that this catches: the route becoming unreachable
(`isSpecTreeStatePath` always false), the auth-bypass hazard (removing the
entry from `QUERY_TOKEN_ELIGIBLE_PATHS` — both affected tests failed, one
in the "should be 200" direction and one in the "should be 401" direction),
and the compute wiring pointing at the wrong function.

**3. Also closed: `pwa/app.js`'s `milestoneTicketCount`/`milestoneAllTickets`
had no test with 2+ epics under one milestone** (every existing fixture in
`pwaDocsExplorer.test.js`/`pwaLocale.test.js` used exactly one epic with
one ticket) — a `reduce` that quietly degenerated to "just the first epic"
would have passed every existing test. Added a two-epics-of-different-sizes
test; hand-mutated `milestoneTicketCount` to confirm the kill. `pwa/app.js`
carries no Stryker/CRAP coverage at all (not compiled into `out/`, not
under `src/`) — this was purely by-hand.

**4. Also closed: `flattenMilestoneTickets` (exported from `docsTree.ts`)
had zero callers and zero tests** — a genuinely uncalled pure export (its
own doc comment claims it is "for consumers that skip the epic tier
(PWA)", but the PWA is a separately-served static JS file that cannot
import from `docsTree.ts`, and `specTreeUiHtml.ts`'s inline `<script>`
duplicates the same flatten logic by hand rather than importing it — so
the claimed consumer does not and cannot exist via import). Low
complexity (CRAP would not have flagged it), but zero test coverage means
any Stryker mutant there would auto-survive forever. Added a direct test
and confirmed the kill. Not deleting the dead export — that is cleanup
territory (cleaner/architect already passed this ticket); noting it here
for visibility rather than filing a ticket, since it is low-risk and
low-value to chase further.

## Mutation (Stryker) — BLOCKED by pre-existing, unrelated repo-wide defects

BL-149 cooldown gate: `bridgeServer.ts`/`consoleMenuUiHtml.ts` →
`skip-cooldown` (recently touched). `specTreeUiHtml.ts`/`docsTree.ts`/
`pwa/app.js` → `run`.

Attempted `stryker run --mutate "out/docs/docsTree.js" --force`. Dry run
failed on the initial full-suite run — TWO separate pre-existing defects,
neither touching any BL-592 file:

1. **BL-720** (ticketed, paused, human-approval-pending):
   `cursorBridgeAgentSession.test.js` unconditionally deletes
   `process.env.CURSOR_API_KEY` instead of restoring the prior value,
   cascading into unrelated files (`pausedPagerJsonFeed` in my run) under
   `isolate: false`. Worked around locally with
   `CURSOR_API_KEY=test-fixture-key` (matches this session's own precedent
   set one ticket ago — `f56b47efe`, BL-1188's hardener pass) — this is
   NOT a fix, just an ambient env value the fixture test expects to
   already exist, exactly the class this session's own `startBridge()`
   calls needed too (real `CURSOR_API_KEY is not set for the headless
   bridge` errors from `bridgeServer.ts`'s own `createLiveCursorBridgeAgentSession`
   path, hit even in a brand-new `epicReorderBridge.test.js` run with no
   BL-592 involvement at all — confirmed by running that file standalone).
2. After working around #1: **`liveRepoDerivationGuard`/BL-1038-class
   violation** in `docsStructureRealTree.test.js` and
   `pilotMkdtempConventionCheck.test.js` — neither file touches any
   BL-592 source. Same standing whole-tree guard already confirmed
   pre-existing above.

Since Stryker's dry run requires the FULL suite green and both blockers
are pre-existing, unrelated, already-known defects (one ticketed as
BL-720; the other matches the `liveRepoDerivationGuard` debt already
present on `main` before this ticket), fell back to hand-authored
mutation sweeps (documented above, per BL-638/no-tool-available
discipline) rather than stall the pipeline chasing unrelated repo debt.

## CRAP (scoped coverage: `docsTree.test.js` + `specTreeUiHtml.test.js` +
## `specTreeBridge.test.js` + `pwaDocsExplorer.test.js` + `pwaLocale.test.js`
## + `bridgeServer.test.js` + `epicReorderBridge.test.js`)

BL-592's own additions, all clean:
- `isSpecTreePath` — complexity=2, coverage=100%, CRAP=2.00
- `isSpecTreeStatePath` — complexity=2, coverage=100%, CRAP=2.00
- `getSpecTreeUiHtml` — complexity=1, coverage=100%, CRAP=1.00
- `getConsoleMenuUiHtml` — complexity=1, coverage=100%, CRAP=1.00
- Every `docsTree.ts` function BL-592 touched or added (`buildEpicNodes`,
  `buildEpicTrackersByKey`, `buildMilestoneNodes`, `flattenMilestoneTickets`,
  `toMilestoneTicketSummary`, `filterDocsTree`) — CRAP 1.00–6.00, all
  ≤ threshold, all 71–100% covered.

24 functions in `bridgeServer.ts` are flagged (CRAP > 6) under this scoped
coverage run — all pre-existing (LetsTalk mirror/choice-poll,
pausedPager, contextBudget, epic-reorder-topic-make-top helpers). Diffed
BL-592's own change to `bridgeServer.ts` against `main`: it is purely
additive (two new standalone functions, two new array entries, one new
`if` block in `startBridge`) — it does not modify the body of any flagged
function. Per the differential-complexity discipline, no regression.

## DRY

`jscpd --config .jscpd.json src` (full-project baseline, since scoping to
individual file paths does not work with this project's jscpd config) —
68 pre-existing clones repo-wide, **zero involving any of
`docsTree.ts`/`specTreeUiHtml.ts`/`consoleMenuUiHtml.ts`** (grepped the
full clone report).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-592-spec-tree-on-live-console-with-epic-tier`.

By hardender.
