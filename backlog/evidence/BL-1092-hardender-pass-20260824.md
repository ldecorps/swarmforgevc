# BL-1092 — hardender pass, 20260824

## Inbound

Merged architect `b0e6dfa129` into `swarmforge-hardender`.

## Scope

Repo-creation guard discovers same-file helpers whose bodies spawn `git`,
then matches `<name>(…, ['init'`. Bare `git(`, string strip, exemptions
unchanged.

## Host / cooldown

| File | Decision |
|---|---|
| `repoCreationGuard.js` | **skip-cooldown** (~2.05d) |

Gherkin soft + surgical (no Stryker).

## BL-113 Gherkin (soft)

```
total=15 completed=15 killed=15 survived=0
outcome: pass
```

(KNOWN_* Outline locks already in steps.)

## Hand-authored surgical

| Mutant | Result |
|---|---|
| drop named-wrapper path | killed |
| never discover wrappers | killed |
| skip string-literal strip | killed |
| ignore exemption | killed |
| treat tar spawn as git | killed |

Survivors: 0.

## Verification

- Acceptance 8/8; unit 21/21; properties 4/4

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1092-the-repo-creation-guard-keys-on-a-wrapper-name`.

By hardender.
