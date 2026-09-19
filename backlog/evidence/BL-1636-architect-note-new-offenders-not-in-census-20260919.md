# BL-1636 guard: new offenders discovered on merge, spec-gap

Architect, 2026-09-19, architect worktree commit 8ad98830f0 (merge main
ab8fa54d84 into architect — the tree union of BL-1636/BL-1639/BL-875/
BL-1642/BL-1646, all independently reviewed clean this session).

## What was found

`npx vitest run test/stepHandlerTmpRootGuard.test.js` fails on the merged
tree: `findStepHandlerTmpRootOffenders` (BL-1636's guard) names two step
handlers as offenders that are not in the committed census
(`extension/test/step-handler-tmp-root-census.txt`, 532 entries,
confirmed via `git show origin/main:extension/test/step-handler-tmp-root-census.txt`):

- `bl1639BabysitterdCensusSteps.js` (BL-1639, active, forwarded to
  hardener this session) — four raw `fs.mkdtempSync` call sites
  (lines 54, 84, 126, 135), cleaned up via an explicit `rmSync` block at
  scenario teardown (lines 117-120), never a `fixtureReaper`
  registration/`track`/`trackedTmpRoot`/`onAbnormalExit` call or a
  recognised sweep helper — so it cleans up on the happy path but is
  invisible to `onAbnormalExit` on a killed run (BL-971's concern), and
  the guard's text-scan (by design) does not recognise a bare `rmSync`
  block as registration.
- `bl875StrayRootPackageLockRemovedSteps.js` (BL-875, active, forwarded
  to hardener this session) — one raw `fs.mkdtempSync` in
  `buildFixedRootFixture`, cleaned up the same way (a `process.on('exit'
  ...)` sweep of `fixtureRoots`, not a recognised marker).

## Why this is a spec gap, not a parcel defect

Both BL-1639 and BL-875 were coded before BL-1636's committed census
existed on their respective branches (BL-1636, BL-1639 and BL-875 were
all minted 2026-09-18/19 and developed in parallel) — neither ticket's
`constraints:` mentioned the other, and BL-1636's own `out_of_scope:`
explicitly excludes migrating existing handlers. Both parcels were
independently reviewed clean by architect this session (no violation in
either, taken alone or against the then-current tree). The gate that now
fires is a genuine product of the MERGE, not of either ticket's own work.

## Effect if unaddressed

Whichever of BL-1636, BL-1639, BL-875 lands on `main` LAST will make
`npx vitest run test/stepHandlerTmpRootGuard.test.js` red for main and
every worktree that merges it — the standing unit-lane guard BL-1636
built, now failing on files it never saw at mint.

## Not this session's to fix

Architect owns architectural review, not production code. Recorded and
routed per Article 4.4 (spec-gap leaves as a note, never a parcel) and
Article 3.2's standing-red handling.
