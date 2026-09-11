# BL-1534 specifier repro of QA's unowned-red note, 2026-09-11

- **Trigger**: QA note 2026-09-11 07:02Z from the BL-1518-a parcel
  ("unowned-red: bl604Trend+bl1373PathSetCache property tests, no ticket"),
  evidence `backlog/evidence/BL-1518-QA-unowned-red-20260911.md` on
  `swarmforge-QA` (commit `f88b2f4ed5`).
- **Tree**: `main` at `8a1a02c8a9`.

## Reproduction (in isolation, on a loaded host)

```
cd extension
npx vitest run --config vitest.properties.config.mjs \
  test/bl1373PathSetCacheInvariants.property.test.js
```

Host 5-minute load average 32-36 at the time (other roles' mutation runs
and a fixture spawning ~10 concurrent `swarm_handoff.bb`).

| test | took | limit | verdict |
|---|---|---|---|
| invariant 1 | 79263 ms | 20000 ms | timed out |
| invariant 2 | 22274 ms | 20000 ms | timed out |
| cache invalidation | 41929 ms | 20000 ms | timed out |

QA's three isolated runs on a quiet host (load ~2.3) passed 3/3; the same
file timed out inside the full lane on 2026-09-09 (BL-1278 QA, "2
timeouts"), 2026-09-09 (BL-1410 QA), 2026-09-10 (BL-1449, BL-1468, BL-1494,
BL-1497, BL-1514 QA evidence) and 2026-09-11 (BL-1518-a QA). Verdict is a
function of host load, which is exactly BL-871 invariant 1's failure mode.

## Why

One `bb swarmforge/scripts/babysitter_check.bb <fixture>` sweep measured
1.59 s at load 33 (a bare `git init` fixture, `main` + `swarmforge-QA`).
The file runs `numRuns` 15 + 10 + 15 = 40 fast-check draws, each creating
a fixture repo and spawning ONE or TWO real sweeps: up to 30 sweeps in
invariant 1 (48 s at 1.6 s each), 10 in invariant 2, 30 in the cache test -
against a 20000 ms per-test budget. The generator space is five constant
prefixes in subsets of size 1..4 (30 subsets), and every draw whose two
sets are equal, or where `paths1` has no path outside `paths2`, returns
without a sweep, so a large share of the 40 draws is wasted while the rest
overrun the budget.

A second, fail-OPEN defect sits beside it: invariant 1 and the cache test
`return` green when NEITHER sweep found the commit ("might be OK if the
sweep can't run in fixtures"), so a sweep that never reports anything
passes both properties. Nothing counts decisive draws.

Owner: BL-1534. first_seen 2026-09-09.
