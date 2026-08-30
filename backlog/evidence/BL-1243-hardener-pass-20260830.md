# BL-1243 — hardener pass

Hardener, 2026-08-30. Merged architect's `179a03508c` (no functional
defect; one non-blocking observation recorded that scenario 02's "never
captured" row exercises `derivePaneActivitySignal` directly rather than
through the real `tryCaptureRolePane` guard — invariant 1 holds either way,
noted for a future reader, not bounce-worthy).

## Mutation cooldown gate (BL-149)

```
extension/src/bridge/residentPaneLive.ts   DECISION: skip-cooldown
file_age_days: 2.26 (cooldown: 3 days)
load_avg: 1.92  cores: 20  busy_threshold: 2.00x (quiet)
```

In cooldown — skipped the full Stryker/hand-authored pass this run. Did a
light spot-check anyway (cheap, and this file carries the ticket's two
invariants) against the core new function, `derivePaneActivitySignal`:

- `paneText === undefined` negated — KILLED (existing undefined test).
- `!paneText.trim()` negated (blank-guard) — KILLED (existing blank/
  whitespace tests).
- `isPaneActivelyProcessing(paneText) ? 'ok' : 'stale'` ternary flipped —
  KILLED (existing ok/stale fixture tests, both directions).

All three restored; compiled file diffed byte-identical against the
pre-mutation copy afterward. Full mutation-tool pass deferred to the next
quiet pass once this file clears the cooldown window (~2026-09-02).

## Re-verified the architect's headline claims (all clean)

- `npm run compile` — clean.
- `npx vitest run test/bl1243PaneActivitySignal.test.js`: 7/7.
- `npm run test:properties -- bl1243`: 4/4.
- `node specs/pipeline/cli.js specs/features/BL-1243-...feature`: 6/6.
- Invariant 2 (no second capture): confirmed by reading
  `residentPaneLive.ts` directly — exactly 2 `capturePane(` call sites on
  the Live Screen path, unchanged from pre-ticket, and `activitySignal` is
  derived from the SAME `paneText` variable `tryCaptureRolePane` already
  captured, not a fresh call.

## CRAP — one pre-existing over-threshold function, confirmed NOT a
## regression (differential check)

```
tryCaptureRolePane  complexity=6  coverage=90%  CRAP=6.03  *** CRAP > 6 ***
derivePaneActivitySignal  complexity=4  coverage=100%  CRAP=4.00
(all other functions in the file <= 5.06)
```

`tryCaptureRolePane` is pre-existing (from before BL-1243); this ticket's
only change to it is adding one object-literal field
(`activitySignal: derivePaneActivitySignal(paneText)`), which does not add
a branch and cannot change cyclomatic complexity. Verified by diffing
against the pre-ticket version of the file (`1a3917b40~1`) and re-running
CRAP against it with the same pre-existing test suite: baseline was
complexity=6, coverage=89%, **CRAP=6.04** — i.e. marginally *higher* before
this ticket touched the file. This is grandfathered debt at the threshold
boundary, not a regression BL-1243 introduced (differential complexity
rule); out of scope for this ticket to fix (BL-1243's own `out_of_scope`
list is deliberately narrow — no new probes/behavior).

## DRY

`npx jscpd src/bridge/residentPaneLive.ts --min-lines 10`: 0 clones.

## Whole-tree standing guards (parcel touches `extension/test/` and
`specs/pipeline/steps/`)

Ran all 17 non-property `test/*Guard*.test.js`. 3 failed —
`liveRepoDerivationGuard`, `socketFixtureShortRootGuard`,
`tempDirTrapGuard` — the same confirmed pre-existing standing-red set named
in this same day's BL-1277/BL-1232/BL-1182/BL-604 hardener passes. None
names `bl1243` or the changed source file.

## Full re-verification

Full `npx vitest run`: 26 failed / 218 failed, 552/578 files passed —
identical failure count to the standing baseline. No regression.

## Merge-drop check (index.js, three-way conflict on the way in)

This merge-up carried a genuine 3-way conflict in
`specs/pipeline/steps/index.js` against this branch's own prior
BL-1182/BL-1232/BL-604 registrations (both sides had registered
overlapping sets in different orders) — resolved as the union, confirmed
`node -e "require('./specs/pipeline/steps/index.js')"` loads clean with all
four (`bl1182`, `bl1232`, `bl604`, `bl1243`) entries present after each of
the three merges this session.

## Orphan process check

`pgrep -f 'node --test|stryker|vitest'` checked by `/proc/<pid>/cwd`; none
rooted in this hardener worktree survived past this pass.

## Verdict

Hardened within scope. Mutation deferred (in-cooldown) with a light
spot-check confirming the core invariant-bearing function is real, not
assumed. One pre-existing CRAP-over-threshold function confirmed via
differential check to be grandfathered debt, not a regression. Forwarding
to documenter.
