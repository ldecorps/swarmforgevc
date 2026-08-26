# BL-1128 — hardener pass — 2026-08-25

Architect tip: `db4def5ce5` on 1128-only cleaner tip `798c6d630e`. Recreated
`swarmforge-hardender` on tip. BL-506: **BL-1128 paths only**.

## Scope

- `swarmforge/scripts/headroom_cap_raise_{lib,cli}.bb`
- `promotion_gates_lib.bb` prefer wiring
- Unit killer for one-sample sustained-CPU mutant
- APS feature

## Gates

| Check | Result |
|---|---|
| Unit headroom lib | ALL PASS |
| Unit promotion_gates | ALL PASS |
| Acceptance | **5/5** |
| Gherkin soft | **inapplicable** (`total=0`) |
| Surgical lib mutants | **7/7 killed** |

### Surgical detail

1. `decide-raise` always-noop  
2–5. ignore throttle / headroom / cooldown / ceiling arms  
6. `memory-headroom?` always true  
7. `sustained-cpu-headroom?` `> trailing 1` → `>=` (killed by new one-sample /
   full-window case)

## CRAP / Stryker TS

N/A — Babashka parcel.

## Forward

`git_handoff` → `documenter`, priority `50`, task
`BL-1128-raise-active-cap-on-host-headroom`, commit = this tip.

By hardener.
