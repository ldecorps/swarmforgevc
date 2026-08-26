# BL-851 swarm-stamp-bridge-serves-sideload-apks-pre-auth — hardener pass — 20260809

Commit reviewed: `1ad7a4657a` (architect's forward, `merge_and_process architect
1ad7a4657a`, findings NONE). Merged into this branch as `cb8c8c05` before any
check below was run (ancestry confirmed via `git merge-base --is-ancestor
1ad7a4657a HEAD`).

## Baseline verification (pre-change)

- `npm run compile` (extension/) — clean.
- `npx vitest run test/bridgeServer.test.js` — 79/79 pass.
- `npx vitest run --config vitest.properties.config.mjs test/sideloadApk.property.test.js`
  — 3/3 pass.
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-851-swarm-stamp-bridge-serves-sideload-apks-pre-auth.feature`
  — 8/8 scenarios pass.
- BL-149 cooldown gate: `bb swarmforge/scripts/mutation_cooldown_gate.bb .
  extension/src/bridge/bridgeServer.ts` (macOS, `SWARMFORGE_MUTATION_GATE_FORCE_CORES=4`
  workaround per BL-797) — `DECISION: skip-cooldown` (file_age_days 0.35 of a
  3-day window). Per the file-change cooldown rule, Stryker mutation is
  unconditionally skipped this pass for this file regardless of load — not run.
- BL-113 soft Gherkin mutation (this feature has a `Scenario Outline`):
  `specs/pipeline/scripts/run_gherkin_mutation.sh
  specs/features/BL-851-...feature "" specs/pipeline/steps/index.js soft` —
  exit 0 (real pass), 4/4 example mutants KILLED, 0 survivors, 0 errors.
  Manifest stamped into the feature file.

## CRAP gate (finding + fix)

`node scripts/crapReport.js src/bridge/bridgeServer.ts` against coverage from
`test/bridgeServer.test.js` flagged BOTH functions this parcel changed:

- `tryServeSideloadApk` — complexity=8, coverage=94%, **CRAP=8.01**
- `resolveSideloadApkFile` — complexity=7, coverage=95%, **CRAP=7.00**

Both were already at 94-95% coverage, so this was not a coverage gap: CRAP
floors at `complexity` when coverage is 100% (`complexity^2 * (1-cov)^3 +
complexity`), so complexity 7 and 8 could never drop under the <=6 threshold
by adding tests alone — the functions themselves needed splitting.

Per the hardener's "behavior-preserving splits so code is testable" duty
(never new product behavior), extracted 5 helpers with no change to
externally observable behavior:

- `isWithinPublicRoot(resolvedPath, publicRoot)` — the prefix-containment
  check, unchanged logic, extracted out of `resolveSideloadApkFile`.
- `statRegularNonSymlinkFile(resolved)` — the lstat/isSymbolicLink/isFile
  guard, unchanged logic, extracted out of `resolveSideloadApkFile`.
- `isEligibleSideloadRequestMethod(method)` — the GET/HEAD method check,
  extracted out of `tryServeSideloadApk`.
- `extractSideloadRequestPathname(url)` — the `?`/`#` stripping, extracted
  out of `tryServeSideloadApk`.
- `writeSideloadApkFileResponse(res, resolved, method)` — the 200 response +
  HEAD-vs-GET body streaming, extracted out of `tryServeSideloadApk`.

`resolveSideloadApkFile` and `tryServeSideloadApk` are now thin composers of
these helpers; the exported signature of `resolveSideloadApkFile` (the only
one referenced by the property tests) is unchanged. No branch was added,
removed, or reordered — the split is a pure decomposition of the same
decision tree, confirmed by re-running every check below unchanged after the
split.

Re-run after the split (`npm run coverage -- --run test/bridgeServer.test.js`
then `node scripts/crapReport.js src/bridge/bridgeServer.ts`):

| function | complexity | coverage | CRAP |
|---|---|---|---|
| `resolveSideloadApkFile` | 4 | 100% | 4.00 |
| `tryServeSideloadApk` | 4 | 100% | 4.00 |
| `statRegularNonSymlinkFile` | 4 | 92% | 4.01 |
| `extractSideloadRequestPathname` | 3 | 100% | 3.00 |
| `isWithinPublicRoot` | 2 | 100% | 2.00 |
| `isEligibleSideloadRequestMethod` | 2 | 100% | 2.00 |
| `writeSideloadApkFileResponse` | 2 | 94% | 2.00 |
| `sideloadApkPublicDir` | 1 | 100% | 1.00 |

All eight functions now at or under the CRAP <=6 threshold.

The file's other 27 pre-existing CRAP-flagged functions
(`mirrorLetsTalkTurnToBubble` at CRAP=96.07 and siblings) are unrelated to
this diff and out of scope for this narrow security-review parcel, per the
same reasoning the cleaner already recorded for the mutation-site-count
advisory.

## Post-split re-verification

- `npm run compile` — clean.
- `npx vitest run test/bridgeServer.test.js` — 79/79 pass, unchanged.
- `npx vitest run --config vitest.properties.config.mjs test/sideloadApk.property.test.js`
  — 3/3 pass, unchanged (both invariant properties, 300 runs each, still
  exercise the split code through the unchanged `resolveSideloadApkFile`
  export).
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-851-...feature` — 8/8 scenarios pass, unchanged.
- DRY: `npx jscpd --config .jscpd.json src/bridge/bridgeServer.ts` — 4 clones
  found, all at pre-existing line ranges (246-287, 736-825, 966-1041), none
  overlapping the sideload-apk region (~1246-1345) touched or added by this
  parcel or the split. No new duplication introduced.
- No orphaned test/mutation processes or leaked fixture tmux servers after
  this pass (`pgrep -fl 'node --test|stryker'` scoped to this worktree: none;
  `pgrep -afl tmux`: only the live swarm's own `.swarmforge/tmux/*.sock`
  server, not a fixture).

## Review goals / invariants — unaffected by the split

Both ticket invariants and all five review goals were confirmed clean by the
architect against the pre-split code (see
`backlog/evidence/BL-851-architect-pass-20260809.md`). The split changes no
branch, no ordering, and no externally observable behavior — it only
regroups the same checks into smaller, independently-testable functions — so
that verdict still holds, and every test that encoded it (property tests,
acceptance scenarios, the symlink-escape regression test) still passes
unchanged against the split code.

## Findings

NONE outstanding. The CRAP gate finding above was fixed within this pass
(behavior-preserving split), not deferred.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-851-swarm-stamp-bridge-serves-sideload-apks-pre-auth`.

By hardener.
