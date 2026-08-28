# BL-592 architect pass — 2026-08-27

## Reviewed commit

`81e7c65678` (cleaner handoff, containing coder's 3-way-merge fix
`e2f33eaec` — "restore 7 paths reverted by session-wide corruption"),
merged into architect at `7143ed711`.

## Context

This is the fourth architect pass on this ticket this session. The prior
three passes never actually reviewed BL-592's implementation: two were
blocked by the branch-tree-collapse incident
([[swarmforge-architect-branch-tree-collapsed-quarantined]]), and my own
immediately-preceding pass (`2885f05e4`) found the "recovery" had healed
the tree-size/deletion-diff check but left 7 of BL-592's files silently
reverted to pre-BL-592 content. Coder's `e2f33eaec` (a real 3-way merge,
not another blind overwrite) restored exactly those 7 files.

## Verification (fresh, against this merge — not reused from the stale
## first-round bounce evidence)

- Diffed all 9 files `e5cf2a3af` (original coder commit) touched against
  current `HEAD`: all 9 are now byte-identical to `e5cf2a3af`
  (`bridgeServer.ts`, `consoleMenuUiHtml.ts`, `docsTree.ts`,
  `docsTree.test.js`, `pwaDocsExplorer.test.js`, `pwaLocale.test.js`,
  `pwa/app.js`, `specTreeUiHtml.ts`, the property test file). The 10th
  (`bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js`) correctly differs —
  it carries the coder's later D1 afterEach/GIT_DIR-scrub fix, verified
  present (`fs.rmSync` in a real `afterEach`, `delete env.GIT_DIR`/
  `GIT_WORK_TREE` in the fixture's `git()` helper).
- `node extension/out/tools/dependency-gate.js` (full-repo, since the
  parcel straddles the `extension/` boundary via `pwa/app.js` — see
  [[bl259-dependency-gate-and-npx-namespace-trap]]) — PASSED, no forbidden
  edges.
- `node extension/out/tools/co-change-report.js` on the 7 restored
  files — all SUSPECTED COUPLING hits are `bridgeServer.ts`'s known role
  as a central hub (other route files, its own test, `index.js`
  registration) — expected, not a BL-592-specific gap.
- `cd extension && npx tsc -p ./` — compiles clean.
- `npx vitest run --config vitest.config.mjs test/docsTree.test.js
  test/pwaDocsExplorer.test.js test/pwaLocale.test.js` — 98/98 passing.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl592SpecTreeEpicTierInvariants.property.test.js` (scoped — never
  the unscoped suite, per [[property-suite-full-run-hijacks-role-branch-refs]])
  — 2/2 passing. Non-vacuity of this exact code was already hand-verified
  in the first-round bounce evidence (`BL-592-architect-bounce-20260827.md`)
  against byte-identical content; not repeated.
- `required_wiring` — all 4 items confirmed present: schema bump + epic
  grouping in `docsTree.ts`; `/spec-tree` + `/spec-tree-state` routes in
  `bridgeServer.ts`; menu link in `consoleMenuUiHtml.ts`; step-file
  registration at `specs/pipeline/steps/index.js:371`.
- Read-only invariant: `specTreeUiHtml.ts` has no form inputs, no
  POST/PUT/DELETE, no storage access — only navigation buttons.
- Two-layer boundary / host-owns-I/O / webview-presentation-only /
  no-webview-storage / secrets-stay-host-side — unchanged from the
  first-round review (content is byte-identical), still compliant.

## Disposition

Architecturally compliant. Forwarding to hardener.
