# BL-1009 — hardender pass, 20260824

## Inbound

Merged architect `8fbddb1b1f` into `swarmforge-hardender`.

## Scope

One pipeline grid across swarms; caption badges (`primary`→`s1`,
`second`→`s2`); remote rows never show live held-by-role; mono-swarm
renders no badges.

## Host / cooldown

| File | Decision |
|---|---|
| `pipelineBoard.ts` | **skip-cooldown** (~0.2d) |
| `conciergeTick.ts` | **skip-cooldown** (~0.1d) |

Gherkin soft + surgical on compiled board (no Stryker — skip-cooldown).

## BL-113 Gherkin (soft)

```
total=9 completed=9 killed=9 survived=0
outcome: pass
```

(Outline ticket/assigned/badge cells.)

## Hand-authored surgical (out/pipelineBoard.js)

| Mutant | Result |
|---|---|
| remote keeps held role | killed |
| badges always on | killed |
| badges never on | killed |
| no default local swarm | killed |
| primary badge → wire identity | killed |

Survivors: 0.

## Verification

- Acceptance 8/8; unit 134/134; properties 12/12 (after `npm run compile`)

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1009-one-unified-pipeline-grid-across-swarms`.

By hardender.
