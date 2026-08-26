# BL-1085 — hardener pass, 20260824

## Inbound

Merged architect `ae8861e57a` into `swarmforge-hardender`.

## Scope

`push_sweep_ahead_range_lib.bb`: one ahead-range gather per tick + cross-tick
refusal cache keyed on tip+ahead SHAs; incomplete gathers never cached;
replay never infers (BL-952).

## Host / cooldown

| File | Decision |
|---|---|
| `push_sweep_ahead_range_lib.bb` | **run** (new) |
| `handoffd.bb` / `push_sweep_lib.bb` | **skip-cooldown** |

No Stryker (babashka). Gherkin + surgical on the cache lib.

## BL-113 Gherkin (soft)

First pass: 3 killed / 4 survived (`ahead_shape` case/char mutants; steps
ignored the capture).

Harden: `KNOWN_AHEAD_SHAPES` exact-set lock on the Outline step.

Recheck: **7/7 killed**, outcome pass.

## Hand-authored surgical

| Mutant | Result |
|---|---|
| cache incomplete payloads | killed |
| always cache-miss | killed |
| ignore :complete? on hit | killed |
| skip per-tick memo | killed |
| always replay (ignore miss) | killed |

Survivors: 0.

## Verification

- Acceptance 11/11
- Unit ALL PASS; property 500 HOLD; fixture ALL PASS

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1085-push-sweep-re-proves-the-same-refusal-every-cycle`.

By hardender.
