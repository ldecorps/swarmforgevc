# BL-851 cleaner pass — 2026-08-09

## Inbound

Merged coder commit `492a920166` (BL-851: close symlink escape in the
pre-auth sideload APK route) into `swarmforge-cleaner` via `git merge`
(ancestry confirmed: `git merge-base --is-ancestor 492a920166 HEAD`).

## Checks run

- `npm run compile` (extension/) — clean, no errors.
- `npx vitest run test/bridgeServer.test.js test/sideloadApk.property.test.js`
  — 79/79 unit tests pass (property file excluded from that run per
  vitest.config.mjs, as designed).
- `npx vitest run --config vitest.properties.config.mjs test/sideloadApk.property.test.js`
  — 3/3 property tests pass in isolation (invariant 1 containment,
  invariant 2 near-miss, concrete non-vacuousness lock-down).
- Full `npm run test:properties` also run: 3 unrelated pre-existing property
  test files failed/timed out (`bl787NamedTunnelInvariants`,
  `bl797MutationGateProbeCrashFallback`, one more not captured in the
  tail-truncated log) — none touch `bridgeServer.ts`, `sideloadApk.*`, or
  files in this commit's diff (`git show 492a920166 --stat` confirms). Not
  this parcel's regression; not investigated further under this ticket's
  scope.
- `node out/tools/mutation-site-count.js extension/src/bridge/bridgeServer.ts`
  — 1490 sites, `over` the 100-site advisory threshold. This is the
  pre-existing file size (1760 lines), not something this narrow
  security-fix diff introduced (the diff adds ~35 net lines, one extracted
  function). Per the mutation-site-size rule this is a soft advisory, not a
  gate: splitting a large pre-existing file is out of scope for a targeted
  security-review parcel and would itself be exactly the "mechanical chop"
  the rule warns against. Noting it here rather than acting on it.

## Findings

NONE. The coder's diff is the cleanup I would have written: the fix is
isolated to a single extracted, well-named, well-commented function
(`resolveSideloadApkFile`) that replaces symlink-following `fs.statSync`
with non-following `fs.lstatSync`, with the pre-existing `tryServeSideloadApk`
reduced to a thin caller. No duplication, no misplaced responsibility, no
mixed abstraction levels introduced. Test additions (property tests, a
concrete regression test, and Gherkin step handlers mirroring the existing
`burnRateSteps.js` pattern) are consistent with project conventions and
carry no cleanup debt.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-851-swarm-stamp-bridge-serves-sideload-apks-pre-auth`.

By cleaner.
