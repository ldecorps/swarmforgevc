# BL-1542 hardener — first-real-measurement survivor census, `webUiFontSizePreference.ts`, 2026-09-18

Scoped Stryker run (`--mutate out/bridge/webUiTicketStripCollapseRoutes.js,out/bridge/webUiFontSizePreference.js
--ignoreStatic --concurrency 6`, registered detach job, ~13 minutes) found 49
survived/no-coverage mutants OUTSIDE BL-1542's own diff, in pre-existing
functions of `webUiFontSizePreference.ts` that predate this ticket
(BL-1153, 2026-08-08/09).

Confirmed via `backlog/evidence/BL-1153-hardener-pass-rematch-20260826.md`:
BL-1153's own hardening pass explicitly deferred Stryker on this exact
module ("Stryker (full) | BLOCKED — dry-run red on standing
`cursorBridgeAgentSession` host debt (unrelated to parcel); surgical
sweep + unit tests cover preference module") and substituted a
4-mutant hand-authored surgical sweep instead. This run is the FIRST
real Stryker measurement of these functions.

Per the "A deferred gate is DISCHARGED when its run completes" rule
(hardender.prompt): this is unowned debt outside BL-1542's own scope, so
it is handed to the specifier for ownership rather than chased in a
feature ticket's hardening pass. BL-1542's OWN diff (the new
`webUiTicketStripCollapseRoutes.ts`, and the new/modified
`readTicketStripCollapsedMap`/`readFontSizeMap`/
`writeWebUiFontSizePreference`'s collapsed-map branch/
`isWebUiTicketStripCollapsedWriteRequestShape`) was fully chased in this
same pass — see `backlog/evidence/BL-1542-hardender-20260918.md`.

## Totals

| File | Survived | No-cov | Owner |
|---|---|---|---|
| extension/src/bridge/webUiFontSizePreference.ts (pre-existing functions only) | 32 | 17 | unowned — this note |

`NoCoverage` is measured against this scoped run's own dry-run include set
(the full unit suite minus two unrelated known-red files), close to but
not identical to the full suite.

## Per-function census (compiled `out/bridge/webUiFontSizePreference.js`, line as Stryker reports)

- `isWebUiFontSizeSurface` (line 65): 1 survived (ConditionalExpression —
  the `typeof value === 'string' &&` half of the closed-set check).
- `webUiFontSizePreferencePath` (line 68): 3 survived (StringLiteral on
  each path segment — `.swarmforge`, `operator`,
  `web-ui-font-size-preferences.json`).
- `clampForSurface` (lines 71–84): 9 total (3 survived + 1 no-cov at the
  `surface === 'live-screen'` branch and its early return; 2 survived + 1
  no-cov at the `!Number.isFinite(px)` / `bounds.default` branch; 2
  survived + 1 no-cov at the `px < bounds.min` / `bounds.min` branch; 1
  survived EqualityOperator at `px > bounds.max`).
- `readPreferenceMap` (lines 87–101): 10 total (2 survived at
  `!fs.existsSync` / `return null`; 1 survived StringLiteral on the
  `'utf8'` read encoding; 6 survived + 1 no-cov at the
  `typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)`
  guard).
- `readWebUiFontSizePreference` (lines 103–112): 2 survived
  (ConditionalExpression + LogicalOperator on
  `typeof raw !== 'number' || !Number.isFinite(raw)`).
- `resolveWebUiFontSizePx` (lines 113–119): 2 survived + 1 no-cov on
  `preference.kind === 'stored'` / `return preference.fontSizePx`.
- `isWebUiFontSizeWriteRequestShape` (lines 167–175): 1 no-cov + 11
  no-cov + 1 no-cov at the `typeof value !== 'object' || value === null ||
  Array.isArray(value)` guard and its `return false` block; 5 no-cov +
  3 no-cov at the `isWebUiFontSizeSurface(record.surface) && typeof
  record.fontSizePx === 'number' && Number.isFinite(record.fontSizePx)`
  return expression. **Zero existing unit tests reach this function at
  all** — it has no direct test file, and is exercised (if at all) only
  transitively through `webUiFontSizeRoutes.ts`'s own route tests, which
  this scoped run's include set did not necessarily traverse into this
  function's branches.

Full per-mutant list (type, mutator, `file:line:col`) is the raw Stryker
output in `/tmp/bl1542_stryker.log` on this session's host — not
committed (host-local scratch); re-running the same `--mutate` command
against the current `webUiFontSizePreference.ts` reproduces it exactly,
since none of these lines were touched by this parcel.

## Recommendation

A standalone ticket (or fold into an existing BL-1153-adjacent tracker) to
harden `webUiFontSizePreference.ts`'s pre-BL-1542 functions:
`isWebUiFontSizeSurface`, `webUiFontSizePreferencePath`,
`clampForSurface`, `readPreferenceMap`, `readWebUiFontSizePreference`,
`resolveWebUiFontSizePx`, `isWebUiFontSizeWriteRequestShape`. The last one
in particular has no direct unit test file at all despite being exported
and load-bearing for `webUiFontSizeRoutes.ts`'s write route.

By hardender.
