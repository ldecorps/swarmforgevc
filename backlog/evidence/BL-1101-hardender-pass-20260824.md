# BL-1101 — hardener pass, 20260824

## Inbound

Merged architect `a7571d6054` (bounce re-fix: bash 3.2 empty-array guard)
into `swarmforge-hardender`.

## Scope

`expedite_mutation_sweep.sh`: skipped mutants fail the run (named), same as
survivors; length-guard before `"${arr[@]}"` under `set -u`.

## Host / cooldown

`expedite_mutation_sweep.sh`: **skip-cooldown** (~1.34d). Gherkin + surgical;
no Stryker (shell).

## BL-113 Gherkin (soft)

```
total=3 completed=3 killed=3 survived=0
outcome: pass
```

(Outline situations: skip / survive / both.)

## Hand-authored surgical

First pass survived print-only / drop-append mutants because APS only
structurally sniffed the live script lightly. Locked Background asserts:

- `SKIPPED+=("$label")`
- `fail=1` inside the SKIPPED length-guard block
- `exit 1` before `ALL MUTANTS KILLED`

Recheck:

| Mutant | Result |
|---|---|
| skip-no-fail (print without fail=1) | killed |
| always-success (drop exit 1) | killed |
| drop-skip-append | killed |
| unguarded empty-array expand | killed |

Survivors: 0.

## Verification

- Acceptance 6/6

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1101-hand-authored-sweep-reports-success-with-skipped-mutants`.

By hardender.
