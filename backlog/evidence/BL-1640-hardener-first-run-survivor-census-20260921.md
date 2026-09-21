# BL-1640 hardener pass — first-run mutation-debt census, 2026-09-21

BL-1640's own mutation_cost is `medium` (TypeScript under Stryker). Ran a
scoped Stryker dry run per file, one at a time (`extension/
vitest.bl1640.stryker.config.mjs`, scoped to `test/nightClosingCeremonyLive.test.js`,
`test/nightClosingCeremonyRun.test.js`, `test/nightClosingCeremonyGate.test.js`
to route around an unrelated full-suite-only red — see
`backlog/evidence/unowned-red-bl1652-role-lane-running-full-suite-hardener-20260921.md`):

```
node scripts/ensureStrykerSandboxSiblings.js
cp stryker.config.json <backup>; set "vitest.configFile" to "vitest.bl1640.stryker.config.mjs"
rm -f stryker-incremental.json
npx stryker run --mutate "out/quality/nightClosingCeremonyLive.js" --force
npx stryker run --mutate "out/tools/night-closing-ceremony-run.js" --force
npx stryker run --mutate "out/tools/night-closing-ceremony-gate.js" --force
restore stryker.config.json from backup; rm vitest.bl1640.stryker.config.mjs
```

## Was any of this a regression from BL-1640's own diff?

No. I checked every survived/no-coverage mutant's line number against the
functions BL-1640 actually added or changed (`advanceSameDayDone`,
`sleepLoopDecision`, `SLEEP_CEILING_GRACE_MS`, `sleepRelativeDeadlines`,
`resolveCeremonyDeadlines`, the `fromSleep` observation field, and the
`drainBudgetMinutes`/`briefingBudgetMinutes` gate exposure) - every one of
those lines is either absent from the survivor/no-coverage list, or (for
`resolveCeremonyDeadlines`'s daemon-window else-branch) is code I moved
verbatim from the pre-BL-1640 ternary without changing it, already
untested before this parcel. Also confirmed via the differential
complexity gate (workflow.prompt): both changed functions
(`advanceNightClosingCeremony`, `runNightClosingCeremony`) had grown past
their `main` baseline complexity (11->13, 11->12); extracted
`advanceSameDayDone`/`resolveCeremonyDeadlines` to restore both to at or
below baseline (11, 10), each new helper landing at CRAP=3, 100% covered.

## The debt itself — first Stryker run ever on these three files

None of the three files (`nightClosingCeremonyLive.ts`,
`night-closing-ceremony-run.ts`, `night-closing-ceremony-gate.ts`) has a
`stryker-incremental.json` history predating this run (deleted before each
run per the stale-cache-trap rule; no incremental result file found on any
of the three). Counts, against the SCOPED include set above (see the
NoCoverage caveat in workflow.prompt - "no test in THIS scope's include
set executes this code" is a fact about the scope, not the full suite;
`night-closing-ceremony-run.ts` in particular is a CLI entrypoint file
most of whose exported dep functions (`applyFreeze`, `instructBriefing`,
`nightStop`, `surface`, `recordCnp`, `deliverLeanPacket`,
`recordEmptyOutcome`, `readActiveRole`, ...) are exercised only through
the real CLI via `test_bl1393_one_ceremony_every_sleep.sh` and the BL-1640
acceptance feature, neither of which Stryker's vitest-only coverage can
see):

| file | survived | no-coverage | total mutants |
|---|---|---|---|
| `out/quality/nightClosingCeremonyLive.js` | 57 | 27 | 260 |
| `out/tools/night-closing-ceremony-run.js` | 38 | 293 | 413 |
| `out/tools/night-closing-ceremony-gate.js` | 24 | 44 | 90 |
| **total** | **119** | **364** | **763** |

119+364=483, well over the ~50 in-pass-chase threshold (BL-1441/BL-1519
rule) and none of it is this parcel's own changed lines, so this is handed
over rather than chased here. Full per-mutant list (outcome, mutator,
`out/<file>:<line>:<col>`) committed alongside this file:
`backlog/evidence/BL-1640-hardener-mutant-census-20260921.txt` (483 lines).

Sent a priority-00 note to the specifier naming this file set and these
counts, per the deferred-gate-discharge rule (workflow.prompt).

By hardener.
