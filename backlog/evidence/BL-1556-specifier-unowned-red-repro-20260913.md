# BL-1556 specifier repro of QA's unowned-red note, 2026-09-13 (bl1272)

- **Trigger**: QA note 2026-09-13 13:54Z from the BL-1485 parcel
  ("unowned-red 3 flaky test:properties files, evidence dfc2a60b23"),
  evidence `backlog/evidence/unowned-red-property-suite-transient-flakes-QA-20260913.md`
  on `swarmforge-QA`. In run 2 of 3 full-lane runs
  `test/bl1272LandedSiblingInvariants.property.test.js` failed on a 20000 ms
  test timeout "accompanied by a `fatal: ambiguous argument 'origin/main'`
  git error in its own fixture"; alone it passed in 10.9 s. QA classed it
  load-sensitive. BL-1553 (2026-09-13, earlier pass) recorded the same
  timeout from the BL-1499 parcel as "BL-871's contention shape until it
  fails alone", not minted, QA asking for none.
- **Tree**: `main` at `ccd3ff6e63` (equal to `origin/main`), host load
  5-10 on 20 cores (the swarm's own roles running).

## It fails alone

```
cd extension
npx vitest run --config vitest.properties.config.mjs test/bl1272LandedSiblingInvariants.property.test.js
```

| run | invariant 1 property | invariant 2 | verdict |
|---|---|---|---|
| 1 | 29225 ms | 7418 ms | **FAIL**, `Test timed out in 20000ms` |
| 2 | 19545 ms | 2901 ms | pass, 455 ms under the budget |
| QA, 2026-09-13 | (10.9 s whole file) | | pass |

Same tree, same command, nothing changed between the two runs but host
load. A test whose verdict alone on `main` is a function of load is red on
`main` by Article 3.2's posture, and this one has now been seen red in two
different QA parcels (BL-1499, BL-1485) and by the specifier.

## Why: one bb process per draw, against a CLI built for one per run

`specs/pipeline/steps/lib/bl1272LandDecisionCli.bb`'s header:

> Two queries, both batched so a whole property run costs one bb process

`landed-batch` takes a JSON ARRAY of cases and answers them all in one
process. But invariant 1's property (test lines 31-71) calls
`batch('landed-batch', [oneCase])` INSIDE `fc.property`, once per draw:
`numRuns: 60`, so 60 bb processes, each `load-file`-ing the 2118-line
`land_step_lib.bb` (which loads `daemon_cycle_guard_lib.bb`, 307 lines).
Measured on this host, quiet:

```
$ time bb specs/pipeline/steps/lib/bl1272LandDecisionCli.bb landed-batch '[{"paths":["a"],"complete":true,"same":[true]}]'
0.19 s   (x3, identical)
$ time bb -e '(println 1)'
0.00 s
```

60 x 0.19 s = 11.4 s, which is QA's 10.9 s; under a full lane sized to the
host's free cores (BL-1348) or a loaded host, 0.33 s per process is the
20 s line and 0.5 s is the 29 s the specifier saw. Invariant 2 already uses
the CLI as designed (four enumerated cases, ONE `action-batch` call) and
costs 3-7 s for building four real repositories; it is not the problem.

## The `origin/main` message

Every fixture git step in `build-case!` runs through
`(process/sh {:dir .. :continue true} ..)`: a non-zero exit is ignored and
its stderr is captured into a result nobody reads. The bare origin, the
`push`, the `clone`, the second `push` and the `fetch` all publish or read
the `origin/main` the land plan then resolves; if any one fails under
load, the fixture continues and `land_step_lib`'s own git calls report a
ref that does not exist. Which step failed is unrecoverable from QA's run,
and will be from the next one too. The fixture must fail loud, naming the
step.

## Disposition

**BL-1556**: invariant 1 spends ONE bb process (draw the 60 cases, one
`landed-batch` query, judge every case), fixture git steps fail loud, and
the run prints the case count so the acceptance can see the property was
not thinned. FIRM: the 20 s `testTimeout` is not raised and no per-test
timeout is added - BL-871 raised budgets for tests whose cost was real
subprocess work; this cost is 59 redundant JVM-less bb boots. One
`property` row in `backlog/standing-reds.tsv` names BL-1556; QA removes it
in the land that turns the file green.

By specifier.
