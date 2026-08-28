# BL-1186 hardener pass — 2026-08-28

## Reviewed commit

Merged architect's `38f100a4c1` clean (purely additive, no conflicts:
697 insertions across the new tool, its two test files, the step handler,
and one `index.js` require line).

## Mutation coverage

`extension/src/tools/deprecate-identify-unused.ts` — BL-149 cooldown gate:
`run` (host quiet, load avg ~4.1 on 20 cores). Stryker's dry run is
blocked on this host by the pre-existing `CURSOR_API_KEY is not set for
the headless bridge` failure in an unrelated bridge test
(`make-top route requires control auth`) — the SAME environment gap that
blocks `bridgeServer.test.js` and `specTreeBridge.test.js` (confirmed
pre-existing against this branch's own tip with no BL-1186 changes at
all). Fell back to a hand-authored mutation sweep over the file's own
decision points, per the degraded-fallback discipline for a tool blocked
by environment rather than code:

1. `hits90d < SELDOM_HIT_CEILING` → `<=` (boundary shift at 3) — killed.
2. `hits90d === 0` → `=== 1` (breaks "0 is always unused, never seldom") — killed.
3. Sort comparator `a.hits - b.hits` → `b.hits - a.hits` (descending instead
   of ascending) — killed.
4. `writePendingNotification`'s `candidates.length === 0` → `< 0`
   (never skips writing on empty) — killed.
5. `readUsageLedger`'s malformed-entry filter, dropped the `hits90d` type
   check (`typeof ... === 'number'`) — killed (a surface with no
   `hits90d` field was let through).

All 5 probes killed by the existing hand-written suite with no changes
needed; source restored clean and re-verified (`npm run compile` +
`vitest run test/deprecateIdentifyUnused.test.js`, 16/16) after each
probe and at the end.

## Verification (re-run)

- `npm run compile` — clean.
- `vitest run test/deprecateIdentifyUnused.test.js` — 16/16 PASS.
- `vitest run --config vitest.properties.config.mjs
  test/deprecateIdentifyUnused.property.test.js` — 5/5 PASS.
- `node specs/pipeline/cli.js
  specs/features/BL-1186-deprecator-identify-unused-notify.feature` — 4/4
  PASS. No `Scenario Outline:` in this feature (grep confirms) — BL-113
  Gherkin mutation does not apply.
- No `extension/` file elsewhere needed CRAP/DRY re-check beyond this one
  new file, which is small and low-complexity (each function single
  early-return branches, no nested conditionals beyond one level).
- Cleaned up the `.stryker-tmp/sandbox-*` dirs left by the blocked dry
  run; no orphaned `node --test`/stryker/vitest processes belong to this
  worktree (checked by cwd, not just pgrep — this host runs concurrent
  worktree test suites).

## Disposition

Hardened via hand-authored mutation sweep (Stryker itself blocked by a
pre-existing, unrelated host environment gap, not this ticket's code).
No gaps found — the architect's own property-test invariants plus the
existing unit suite already cover every mutation class I tried. Forwarding
to documenter.
