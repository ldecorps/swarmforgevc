# BL-1020 — hardener pass, 20260824

## Inbound

Merged architect `faa25f7aa4` into `swarmforge-hardender`.

## Scope

`resolve-resident-role`: standing packs ignore leftover
`mono-router-active-role` as topology (`:honour-marker? false`, `:role` from
pack home); leftover flagged `:stale?`. Router packs still honour the marker.

## Host / cooldown

| File | Decision |
|---|---|
| `mono_router_lib.bb` | **run** (~4.75d) |
| `relaunch_resume_cli.bb` | **run** (~28d) |
| `swarm_attach.sh` | **run** (~32d) |

No Stryker (babashka). Surgical on `resolve-resident-role`.

## BL-113 Gherkin (soft)

**inapplicable** — no Scenario Outline example table. Acceptance 3/3 green.

## Hand-authored surgical

| Mutant | Result |
|---|---|
| always honour marker (ignore standing branch) | killed |
| standing uses marker role | killed |
| never stale on standing | killed |
| invert rotation-router? gate | killed |
| honour-marker? true on standing | killed |

Survivors: 0.

## Verification

- Acceptance 3/3
- `mono_router_lib_test_runner.bb` ok
- Property runner 500 runs ALL HOLD

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1020-stale-mono-router-marker-is-not-topology`.

By hardender.
