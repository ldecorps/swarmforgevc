# BL-1322 hardener pass — 2026-09-01

Role: hardener
Verdict: PASS — nothing to fix in the changed code; forwarding to documenter.

## What was reviewed
Merged architect commit `c6414820f2` (cleaner `3c5476fdaf` NONE, coder
`4c88141782`) onto this worktree as `d5420645dd`. The parcel's actual code
change is a 2-line move of `resolveCursorApiKey(targetPath)` out of
`createLiveCursorBridgeAgentSession`'s top level and into `ensureAgent`'s
`if (!cachedAgent)` block, in `extension/src/bridge/cursorBridgeAgentSession.ts`.

## Checks run
- `npm run compile` — clean.
- `vitest run test/cursorBridgeAgentSession.test.js` — 67/67.
- `vitest run --config vitest.properties.config.mjs cursorBridgeAgentSessionLazyApiKey`
  — 1/1 (the invariant property test).
- `node specs/pipeline/cli.js specs/features/BL-1322-...feature` — 4/4.
- The 8 previously CURSOR_API_KEY-broken files from BL-1313's QA evidence
  (bridgeServer, epicMakeTopBridge, epicReorderBridge, pausedPagerBridge,
  specTreeBridge, startBridgeHeadlessCli, telegramCursorBridgeCli,
  topicMakeTopBridge) — 210/210 pass, no CURSOR_API_KEY failures.
- Standing whole-tree guards (parcel touches `specs/pipeline/steps/` and
  `extension/test/`): ran all 16 `test/*Guard*.test.js` (excluding
  `.property.` siblings). 3 failed, all pre-existing and unrelated,
  already ticketed:
  - `tempDirTrapGuard.test.js` — `swarmforge/scripts/test/*` fixtures, none
    matching this ticket. `backlog/paused/BL-1289-...yaml`.
  - `socketFixtureShortRootGuard.test.js` — `bl1112StandingUnitRedsSteps.js`
    / `bl691AmbulanceWorkflowGapsSteps.js`, neither touched by this parcel.
    `backlog/paused/BL-1290-...yaml`.
  - `liveRepoDerivationGuard.test.js` — `bl1243PaneActivitySignal.test.js`,
    `deprecateRetiredReferents.test.js`, `docsStructureRealTree.test.js`,
    none touched by this parcel. `backlog/paused/BL-1291-...yaml`.
  Confirmed via grep: none of the three violation lists names any file this
  ticket touches.
- `node scripts/crapReport.js src/bridge/cursorBridgeAgentSession.ts` — one
  violation: `runFrontDeskOneShot` complexity=6, coverage=0%, CRAP=42.00.
  Same finding the cleaner already recorded and confirmed pre-existing
  (present on `main` before `4c88141782`, untouched by this ticket's diff)
  — out of scope, not fixed here (BL-1192 discipline).
- `npx jscpd --config .jscpd.json src/bridge/cursorBridgeAgentSession.ts` —
  0 clones, 0% duplication.
- Mutation: `mutation_cooldown_gate.bb` returned `DECISION: run` (file age
  7.25d > 3d cooldown, load quiet). Scoped Stryker run via the existing
  `stryker.letsTalkCursorBridge.config.json` (whose `vitest` config file
  excludes the guard test files, avoiding the pre-existing standing-red
  dry-run block), `--mutate out/bridge/cursorBridgeAgentSession.js
  --concurrency 4`, detached via `detach_job.sh` (registered, EXIT=0 in
  1m41s): 65.79% mutation score, 195 killed / 30 survived / 5 timeout / 74
  no-coverage.
  - Checked every survivor and every no-coverage mutant against the
    ticket's actual diff lines (the `apiKey` move into `ensureAgent`,
    ~lines 356-359): **zero** land on those lines. All 30 survivors and
    both line-353 no-coverage mutants sit in unrelated, unmoved code —
    `shouldUseFrontDeskRunner`/provider forcing (~75-81), agent-reset
    error handling (~268-285), `toSdkUserMessage` (~330-331), the
    pre-existing `modelId` line (~353, unmoved by the diff), and
    `prompt.text` fallback (~415). None of these were touched by
    `4c88141782`.
  - The changed lines themselves (the `if (!cachedAgent) { const apiKey =
    resolveCursorApiKey(...); ... }` block) generate mutants that do not
    appear in the survivor or no-coverage lists — i.e. they were killed,
    consistent with the architect's non-vacuous invariant property test.
  - No hardening action taken: nothing in the parcel's own diff is
    uncovered or survives mutation; the pre-existing debt in the rest of
    the 451-line file is out of this ticket's scope (same file, same
    debt the cleaner already flagged for `runFrontDeskOneShot`).

## Conclusion
No hardener-owned defect. The parcel's own change is fully covered and
kills every mutant generated on its lines. Forwarding unchanged to
documenter on this merge commit.
