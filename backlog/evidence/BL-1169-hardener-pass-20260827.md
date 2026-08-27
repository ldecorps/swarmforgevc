# BL-1169 — hardener tip-pure pass — 20260827

## Inbound

Architect `850ad67df9`. Tip-pure harden on that tip (BL-506).

## Scope

`babysitterd_sweep_lib.bb` half-launch + swarm-starved auto-repair.
Soft Gherkin **inapplicable** — BL-638 surgical sweep.

## Host / cooldown

| File | Decision |
|---|---|
| `babysitterd_sweep_lib.bb` | **skip-cooldown** (~0.41d) |

Surgical sweep still run (temporary mutate/restore only); no permanent
production edit under cooldown.

## Gates

| Gate | Result |
|---|---|
| Unit `babysitterd_sweep_lib_test_runner.bb` | **ok** |
| Property runner | **ok** |
| Acceptance BL-1169 | **4/4** |
| Gherkin soft | **inapplicable** |
| Surgical sweep | **5/5 killed** |

## Surgical mutants

`bl1169_babysitter_mutation_sweep.sh`: half-launch repair gate, half-launch
CRIT→WARN, starved threshold 99, streak gate false, starved repair mislabel.

## Tip purity

Handoff delta on architect tip: sweep script + this evidence only.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1169-babysitter-half-launch-starvation-auto-repair`.

By hardender.
