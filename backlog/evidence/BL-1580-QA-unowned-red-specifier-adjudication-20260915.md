# BL-1580 QA unowned-red note - specifier adjudication (2026-09-15)

Inbound: `00_20260915T213650Z_002764_from_QA_to_specifier`, "BL-1580
unowned-red: 4 lane timeouts (bl1308/1315/1343/1354), see 325fe1d4ea".
QA evidence: `backlog/evidence/BL-1580-QA-unowned-red-20260915.md`.

## What QA observed

Two full `npm run test:properties` runs (408 files) at the BL-1580 parcel
commit `bd41e42af2`. Run 1 timed out `bl1308SiblingDetectorCoversReplay`
and `bl1315OwnPathsFullRangeInvariants`; run 2 timed out
`bl1343ReplayNeverDropsOwnPathInvariants` and
`bl1354SharedPathLandedSiblingInvariants`. All four read
`Error: Test timed out in 20000ms.` verbatim (QA recorded the text per file,
as the QA prompt now requires). All four green alone or three together on a
quiet host, 8.0 to 14.8 s per test.

## Ownership check

- `grep -rlE 'bl1308|bl1315|bl1343|bl1354' backlog/paused backlog/active`
  hits only BL-1586 and BL-1587, the sampled-reach-floor sweeps, which list
  these files for a DIFFERENT defect class (a floor missed by a draw, not a
  timeout). The register is keyed per test file, and none of the four has a
  row (`backlog/standing-reds.tsv` carries only BL-1580's and BL-1581's rows).
- BL-1579 (closed, `backlog/done/`) owned `bl1343` and `bl1323` for the
  same class under synthetic load on a file alone and retired its rows on
  30/30 green. Its scope never included `bl1308`, `bl1315` or `bl1354`.
  Genuinely unowned under Article 4.2, including the `bl1343` recurrence.

## Verification of QA's hypothesis (read, not guessed)

- `extension/test/helpers/propertyLaneContentionBudget.js`:
  `propertyLaneTimeoutMs(base)` calls `resolveUnitLaneTimeout` with
  `cpuCountFn: () => 4`, so factor = `os.loadavg()[0] / 4`, and
  `effectiveBudgetMs` returns the base whenever that factor is at or under
  1. It is evaluated once, as the third argument of `test(...)`, when the
  worker collects the file.
- `extension/vitest.properties.config.mjs`: `testTimeout: 20000`, forks pool
  sized by `resolveVitestWorkerPool` from the host's free cores (20 cores
  minus the 5-minute load, BL-1348), so a quiet host starts many forks.
- Vitest `BaseSequencer.sort` (node_modules/vitest/dist/chunks/coverage.*.js):
  with no cache, larger files first; with a cache, failed files first, then
  longer first. The four files are among the largest and slowest, so they
  run in the lane's first wave, when the 1-minute load average still reads
  the pre-run quiet band (QA: 1.75 to 1.87). Factor under 1, budget 20 s,
  while every fork is busy. This is consistent with `bl1343` printing the
  unscaled `20000ms` despite BL-1579's wiring, and with a different pair
  timing out each run (run 2's cache moved run 1's failures to the front).
- `bl1308`, `bl1315`, `bl1354`: no `propertyLaneTimeoutMs` call at all;
  each spawns `bb` and `git` per draw (`spawnSync('bb'`, `execFileSync('git'`
  inside the property body), 12 to 25 runs per invariant.

Population: a grep for any `bb`/`git` spawn anywhere in a property file
matches 113 of 407 files, most of them one-off fixture setup, so it does
not define the class (BL-1445). The owner pins the population by NAMED
files: the four above in its scenarios, plus BL-1579's two in its e2e
procedure. The verbose reporter's per-test durations from the reproduction
run are the census the coder records.

## Outcome

Minted BL-1588 (`type: defect`, `severity: high`, epic code-quality-gates)
owning all four files; four register rows added naming it; QA sent the
resume note (BL-1566 shape) the same pass.
