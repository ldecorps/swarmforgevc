# BL-1112 — hardender pass, 20260824

## Inbound

Merged architect bounce-refix `a36e86a758` into `swarmforge-hardender`.

## Scope

Standing unit reds: `listProcessTree` uses `ps args=` + basename; Stryker
sandbox unlinks dangling sibling links before recreate (no EEXIST).

## Host / cooldown

| File | Decision |
|---|---|
| `strykerSandboxSiblingsLib.js` | **run** |
| `resourceSamplerActivation.ts` | **run** |

## BL-113 Gherkin (soft)

```
total=4 completed=4 killed=4 survived=0
outcome: pass
```

## Harden locks

- `fakeAgentTree` spawns claude via absolute argv0 so basename is load-bearing.

## Hand-authored surgical

| Mutant | Result |
|---|---|
| skip unlink before symlink | killed |
| unlink noop | killed |
| ps args= → comm= | killed |
| drop path.basename | killed |

Survivors: 0.

## Verification

- Acceptance 6/6; resourceSampler 22/22; stryker siblings 21/21

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1112-standing-unit-reds-sample-resources-and-stryker-sandbox`.

By hardender.
