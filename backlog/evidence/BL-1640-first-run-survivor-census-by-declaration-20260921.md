# BL-1640 first-run mutation debt, per enclosing declaration - 2026-09-21 (specifier)

Source: the hardener's per-mutant list `backlog/evidence/BL-1640-hardener-mutant-census-20260921.txt`
(hardender branch 76bf756a69; three scoped Stryker runs, include set
`test/nightClosingCeremonyLive.test.js`, `test/nightClosingCeremonyRun.test.js`,
`test/nightClosingCeremonyGate.test.js`), each `out/<file>:<line>:<col>` attributed
to the enclosing top-level declaration of the compiled file in the hardender
worktree (`.worktrees/hardender/extension/out/`). NoCoverage is against that
THREE-FILE scope (BL-1519's caveat): `rotateDocumenter`/`spawnConsultDocumenter`,
for one, have a landed vitest file outside it. Every owner slice re-measures over
the full unit suite first.

## `out/quality/nightClosingCeremonyLive.js` - survived 57, no-coverage 27, debt 84

| declaration | survived | no-cov | debt |
|---|---|---|---|
| `advanceBriefing` | 12 | 11 | 23 |
| `startFrozen` | 13 | 4 | 17 |
| `advanceFrozen` | 7 | 10 | 17 |
| `enterBriefing` | 11 | 0 | 11 |
| `advanceNightClosingCeremony` | 6 | 2 | 8 |
| `idleState` | 6 | 0 | 6 |
| `pushUnique` | 2 | 0 | 2 |

## `out/tools/night-closing-ceremony-gate.js` - survived 24, no-coverage 44, debt 68

| declaration | survived | no-cov | debt |
|---|---|---|---|
| `parseArgs` | 0 | 29 | 29 |
| `inCeremonyWindow` | 15 | 9 | 24 |
| `readBudgets` | 8 | 0 | 8 |
| `main` | 0 | 6 | 6 |
| `evaluateGate` | 1 | 0 | 1 |

## `out/tools/night-closing-ceremony-run.js` - survived 38, no-coverage 293, debt 331

| declaration | survived | no-cov | debt |
|---|---|---|---|
| `parseArgs` | 0 | 58 | 58 |
| `buildRealDeps` | 0 | 51 | 51 |
| `sendHandoffNote` | 0 | 28 | 28 |
| `shiftWorkedSinceLastCeremony` | 0 | 25 | 25 |
| `runNightClosingCeremony` | 21 | 1 | 22 |
| `briefingSent` | 0 | 20 | 20 |
| `rotateDocumenter` | 0 | 17 | 17 |
| `spawnConsultDocumenter` | 0 | 15 | 15 |
| `scanInFlight` | 0 | 13 | 13 |
| `newestMtimeMs` | 0 | 12 | 12 |
| `readActiveRole` | 0 | 11 | 11 |
| `applyAction` | 3 | 8 | 11 |
| `listHandoffs` | 0 | 10 | 10 |
| `main` | 0 | 6 | 6 |
| `scanHeld` | 0 | 5 | 5 |
| `localDayKey` | 5 | 0 | 5 |
| `statePath` | 0 | 4 | 4 |
| `readLiveState` | 0 | 4 | 4 |
| `writeLiveState` | 0 | 4 | 4 |
| `parseHmToMs` | 3 | 0 | 3 |
| `resolveCeremonyDeadlines` | 1 | 1 | 2 |
| `withRuntimeLoudCodes` | 2 | 0 | 2 |
| `gateBypassed` | 2 | 0 | 2 |
| `ceremonyIsDue` | 1 | 0 | 1 |

## The script (exact)

```
python3 - <census.txt> .worktrees/hardender/extension/out <<PY2
import re,sys,collections
pat=re.compile(r'(Survived|NoCoverage)\s+(\w+)\s+out/([\w/.-]+\.js):(\d+):(\d+)')
rows=[(m.group(3),int(m.group(4)),m.group(1)) for l in open(sys.argv[1]) for m in [pat.search(l)] if m]
def decls(path):
    d=[]
    for i,l in enumerate(open(path).read().split('\n'),1):
        m=(re.match(r'^(?:async\s+)?function\s+(\w+)\s*\(',l) or re.match(r'^(?:const|let|var)\s+(\w+)\s*=',l)
           or re.match(r'^exports\.(\w+)\s*=',l) or re.match(r'^class\s+(\w+)',l))
        if m: d.append((i,m.group(1)))
    return d
for f in sorted(set(r[0] for r in rows)):
    d=decls(sys.argv[2]+'/'+f); by=collections.defaultdict(collections.Counter)
    for ff,ln,st in rows:
        if ff==f: by[max([n for i,n in d if i<=ln] or ['<module-top>'], key=lambda n: 0)][st]+=1  # last declaration at or before ln
    print(f, {k:dict(v) for k,v in by.items()})
PY2
```

Ruling and owners: BL-1674 (live state machine), BL-1675 (gate CLI), BL-1676 (run CLI
survivors and the full-suite re-measure); the run CLI's no-coverage mass is a remaining
slice on BL-1519 under the human's ruling A of 2026-09-10 (thin-wrap the adapter builders
or cover them; grandfather the rest under the changed-path gate). By specifier.
