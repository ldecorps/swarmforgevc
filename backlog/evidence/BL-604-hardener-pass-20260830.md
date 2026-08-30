# BL-604 — hardener pass

Hardener, 2026-08-30. Merged architect's `4c84d5e4d4` (no defect found;
review confirmed both declared invariants non-vacuous, `required_wiring`,
degrade-on-throw posture, and the "absence of data is never a finding"
contract all the way to the sent email).

## Mutation cooldown gate (BL-149)

```
extension/src/metrics/trendAnalysis.ts          DECISION: run
extension/src/tools/trend-analysis-section.ts   DECISION: run
swarmforge/scripts/briefing_email_lib.bb        DECISION: skip-cooldown (2.40d)
swarmforge/scripts/handoffd.bb                  DECISION: skip-cooldown (0.52d)
load_avg: 5.99  cores: 20  busy_threshold: 2.00x (quiet)
```

`.bb` files skipped this pass per BL-149 (also have no wired mutation tool
per Engineering Rules regardless). Both TS files eligible and quiet host —
proceeded.

## Stryker — blocked by pre-existing baseline, hand-authored sweep instead

Same recurring shape as this session's BL-1182 pass and the documented
BL-1228/BL-387/etc. history: `coverageAnalysis: perTest` requires a green
whole-suite dry run, and this worktree's suite carries the standing
26-failed-file/218-failed-test baseline (re-confirmed unchanged below). Per
BL-638, hand-authored the sweep against the compiled JS instead, restoring
after each mutant, `npx vitest run test/trendAnalysis.test.js` as the kill
oracle.

### `trendAnalysis.ts`

- `significance >= 1` → `> 1` — **SURVIVED** (no exact-1 boundary test).
  Fixed: added a boundary test at `significance === 1` and `=== 0.25`. KILLED.
- `significance >= 0.25` → `> 0.25` — same fix, KILLED.
- `Number.isInteger(value)` negated — **SURVIVED** (no non-integer-value
  test). Fixed: added a fractional-delta test asserting `.toFixed(2)`
  rendering. KILLED.
- `delta > 0 ? '+' : ''` → `delta >= 0 ? '+' : ''` — **SURVIVED twice**: the
  existing flat/zero-delta test only checked `text.includes(direction)` and
  `.includes('prior period')`, and a naive `includes('0')` fix-attempt was
  itself a false-negative (`'+0'` still contains `'0'` as a substring — the
  "assert the forbidden COMPOSITION, not a bare substring" class of trap).
  Fixed properly with an exact-prefix assertion
  (`text.startsWith('Approval taps: flat 0 ')`) that cannot pass on '+0'.
  KILLED, confirmed by re-mutating and re-running.
- sort comparator `b.significance - a.significance` reversed — KILLED
  (existing ranking test).
- tie-break `|| a.seriesId.localeCompare(b.seriesId)` removed — KILLED
  (existing tie-break test).
- `bullets.length === 0` negated — KILLED (existing empty-render test).
- `trend.direction === 'unknown'` negated — KILLED (existing
  cannot-be-trended tests).
- `Math.max(0, maxBullets)` → bare `maxBullets` (clamp removed) —
  **SURVIVED** (no negative-bound test; `.slice(0, -1)` silently produces
  weird-but-non-throwing results rather than an error, so this is a real
  defensive guard with no observable effect on any prior test). Fixed:
  added a negative-bound test asserting the section renders zero bullets
  rather than slicing from the array's end. KILLED.
- `trend.delta === null || trend.currentValue === null || trend.priorValue
  === null` (the three null-narrowing clauses alongside the
  `direction === 'unknown'` check) — **accepted equivalent (BL-234)**. Read
  `trend.ts`'s `computeTrend` directly: its only two return branches are (a)
  `direction: 'unknown'` paired with `currentValue`/`priorValue`/`delta` ALL
  `null`, or (b) a real `direction` (`up`/`down`/`flat`) paired with all
  three non-null. The three null checks can never fire independently of the
  `direction === 'unknown'` check — verified by removing all three and
  confirming SURVIVED (23/23 still green). This is TypeScript
  defensive type-narrowing to satisfy the compiler's `number | null` types,
  not a second runtime branch; matches the architect's own read of this
  code. Not chased into a test.

### `trend-analysis-section.ts`

- `main`'s `argv[0] ? argv[0] : resolveProjectRoot(cwd)` ternary branches
  swapped — killed by the existing test (which passes a truthy `argv[0]`
  and would then wrongly resolve via `cwd`).
- The `resolveProjectRoot(cwd)` fallback value itself replaced with a
  hardcoded string — **SURVIVED** (the omitted-argv branch was never
  exercised at all — a real BL-419-class "shipped, unit-tested, wired
  nowhere" gap on the fallback path specifically). Fixed: added
  `main([], '/tmp')` throwing `Cannot resolve SwarmForge project root`
  (verified live: `/tmp` has no `.swarmforge/roles.tsv` reachable via git,
  so `resolveProjectRoot` genuinely throws there) — this only passes if the
  omitted-argv branch actually calls `resolveProjectRoot(cwd)`. Both this
  mutant and the ternary-swap re-verified KILLED after the fix.

All mutants restored; both compiled files diffed byte-identical against
their pre-mutation copies before the final clean re-run.

## Test additions

`extension/test/trendAnalysis.test.js`: 19 → 23 tests (4 new: two
significance boundaries, one non-integer-value render, one negative-bound
clamp) plus 2 existing tests strengthened (exact magnitude-prefix assertion
on the per-case loop, and the CLI's omitted-argv fallback path). All green.

## CRAP

```
analyseSeries              complexity=5  coverage=100%  CRAP=5.00
significanceLine           complexity=4  coverage=100%  CRAP=4.00
trendAnalysisSectionText   complexity=4  coverage=100%  CRAP=4.00
main (CLI)                 complexity=3  coverage=83%   CRAP=3.04
... remainder complexity 1-2, all CRAP <= 2.09
```
All <= 6.00. The one `<anonymous> coverage=0% CRAP=2.00` in
`trend-analysis-section.ts` is the top-level `if (require.main === module)`
CLI-entrypoint guard — in-process untestable by construction, thin-wrapper
shape, not a gap (CLI-entrypoint-CRAP-trap rule).

## DRY

`npx jscpd src/metrics/trendAnalysis.ts src/tools/trend-analysis-section.ts
--min-lines 10`: 0 clones.

## Full re-verification

- `npx vitest run test/trendAnalysis.test.js`: 23/23.
- `npm run test:properties -- bl604`: 4/4.
- `node specs/pipeline/cli.js specs/features/BL-604-...feature`: 8/8.
- `bash test_handoffd_briefing_email_wiring.sh`: ALL PASS (unrelated wiring
  regression check, confirms no damage to the consolidated daemon's
  briefing sweep).
- Whole-tree standing guards (parcel touches `extension/test/` and
  `specs/pipeline/steps/`): 17 non-property `test/*Guard*.test.js` files,
  3 failed — `liveRepoDerivationGuard`, `socketFixtureShortRootGuard`,
  `tempDirTrapGuard` — the same confirmed pre-existing standing-red set
  named in this same day's BL-1277/BL-1232/BL-1182 hardener passes; none
  names `bl604` or either changed source file.
- Full `npx vitest run`: 26 failed / 218 failed, 551/577 files passed (up
  from 550/576 pre-pass — the 4 new tests all pass) — identical failure
  count to the standing baseline. No regression.

## Orphan process check

Every `node --test|stryker|vitest` process checked by `/proc/<pid>/cwd`;
none rooted in this hardener worktree survived past this pass.

## Verdict

Hardened. Five real gaps found and closed (two significance boundaries, a
non-integer render path, a negative-bound clamp, and the CLI's
omitted-argv fallback branch); one accepted equivalent recorded (the
null-narrowing triple, BL-234, verified from `trend.ts`'s own contract).
Stryker itself blocked by an already-known, unowned baseline defect;
hand-authored sweep substituted per BL-638. Forwarding to documenter.
