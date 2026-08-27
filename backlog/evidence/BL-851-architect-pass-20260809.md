# BL-851 swarm-stamp-bridge-serves-sideload-apks-pre-auth — architect pass — 20260809

Commit reviewed: `1a011a2f3c` (cleaner's forward, `merge_and_process cleaner
1a011a2f3c`), which itself carries coder's `492a920166` ("BL-851: close
symlink escape in the pre-auth sideload APK route"). Merged into this branch
as `98be3000` before any check below was run (ancestry confirmed via
`git merge-base --is-ancestor 1a011a2f3c HEAD`).

## Files under review

- `extension/src/bridge/bridgeServer.ts` — `SIDELOAD_APK_PATH`,
  `sideloadApkPublicDir`, `resolveSideloadApkFile` (new, extracted),
  `tryServeSideloadApk`, and the call site in `startBridge`.
- `extension/test/bridgeServer.test.js` — traversal + new symlink-escape
  regression test.
- `extension/test/sideloadApk.property.test.js` — new, BL-654 coder-authored
  property tests for both declared invariants.
- `specs/features/BL-851-...feature` — promoted from `.feature.draft` to
  live, 8 scenarios (4-example outline), with
  `specs/pipeline/steps/bl851SideloadApkPreauthSteps.js` driving the real
  compiled bridge over raw HTTP.

## Checklist run

- **Dependency-rule gate (BL-259, hard gate):** `node
  extension/out/tools/dependency-gate.js src/bridge/bridgeServer.ts` (from
  `extension/`) — **PASSED, no forbidden edges.**
- **Co-change / logical coupling (BL-255):** `node
  extension/out/tools/co-change-report.js src/bridge/bridgeServer.ts`. Top
  suspected-coupling entries are `bridgeServer.test.js` (27) and
  `specs/pipeline/steps/index.js` (25) — a source file co-changing with its
  own test file and with the step-registry file every new step-handler
  module registers into. Both are the expected shape, not a new coupling
  this parcel introduced. No entry in the report ties this ticket's diff to
  an unrelated module.
- **Invariants review (BL-633/BL-654):** ticket declares two invariants.
  Both have executable property-test coverage authored by the coder, first
  authorship correctly resting with coder per BL-654:
  - Invariant 1 (containment: only regular files inside the public dir,
    never a directory/symlink-target outside it) —
    `sideloadApk.property.test.js`'s "invariant 1" test, 300 runs over
    `{legit, escapeSymlink, directory}` x generated safe suffixes.
  - Invariant 2 (adding the route never widens what auth'd routes below can
    reach) — structurally guaranteed by `tryServeSideloadApk` returning
    `false` before any fs access whenever the method/regex doesn't match
    (confirmed by reading `startBridge`'s handler: the sideload check runs
    after the Mini-App/Let's-Talk literal-path routes, none of which can
    collide with `SIDELOAD_APK_PATH`, and before `writeRoutes`/
    `isAuthorizedForRead` — nothing below it lost its gate), and exercised
    end-to-end by acceptance scenario 05 ("every other route still demands
    the bearer") plus `sideloadApk.property.test.js`'s "invariant 2"
    near-miss property (a poisoned near-match of the naming pattern is never
    intercepted, 300 runs).
  - **Non-vacuousness verified independently, not taken on the commit
    message's word:** reverted `out/bridge/bridgeServer.js`'s
    `fs.lstatSync` back to `fs.statSync` (the exact defect review goal 1
    found) and re-ran `npx vitest run --config vitest.properties.config.mjs
    test/sideloadApk.property.test.js` — both the fast-check property and
    the concrete lock-down test failed against the broken build (symlink
    resolved instead of rejected). Restored the fix and re-ran: 3/3 pass
    again.
- **Review goals 1-4 (ticket description):** goal 1 (symlink escape) is the
  defect the coder's commit fixes, confirmed above. Goal 2 (ordering) and
  goal 4 (directory-listing exposure) confirmed by code read — the branch
  only serves an entry that survives `SIDELOAD_APK_PATH` + prefix-check +
  `lstat` regular-file check, so nothing else under
  `.swarmforge/operator/public/` is reachable regardless of what else lands
  there. Goal 3 (traversal test ambiguity) is resolved: the new symlink test
  asserts `404` — a status only `tryServeSideloadApk` itself returns for a
  matched-but-rejected name, distinct from the `401` a never-matched name
  falls through to, so the two failure modes are now distinguishable in the
  suite (see the test's own comment).
- **Goal 5 (content-length vs. mid-request file replacement):** a narrower
  TOCTOU concern, explicitly not closed by this parcel and flagged by the
  coder as a candidate follow-up rather than silently dropped. It bears on
  neither declared invariant (integrity of a race window, not
  authorization/containment) — accepting the descope, not a send-back.
- **Architecture (two-layer boundary, extension-host-owns-IO, no webview
  storage, no secrets in target dir):** all edits are extension-host-only
  (`bridgeServer.ts`); no webview code touched; no browser storage; no
  secret written to the target working directory or committed. No agent
  process spawned; this is a plain HTTP route, tmux/process substrate
  untouched. Compliant.
- **Tests:** `npx vitest run test/bridgeServer.test.js` — 79/79 pass.
  `npx vitest run --config vitest.properties.config.mjs
  test/sideloadApk.property.test.js` — 3/3 pass. Acceptance: `node
  specs/pipeline/cli.js
  specs/features/BL-851-swarm-stamp-bridge-serves-sideload-apks-pre-auth.feature`
  — 8/8 scenarios pass.
- **Compile:** `npm run compile` (extension/) — clean.

## Findings

NONE. The fix directly and correctly closes the symlink-escape defect review
goal 1 identified, is structurally sound for invariant 2, and both declared
invariants carry non-vacuous property coverage that I independently
confirmed catches the regression it claims to catch.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-851-swarm-stamp-bridge-serves-sideload-apks-pre-auth`.

By architect.
