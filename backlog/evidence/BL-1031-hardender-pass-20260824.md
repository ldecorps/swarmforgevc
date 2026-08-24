# BL-1031 — hardener pass, 2026-08-24

## Inbound

Merged architect `323685e6ec` (on cleaner `8ad9e36125` / coder
`b03e1263bb`) into `swarmforge-hardender`.

## Scope

Route spawn-reachable `babashka.process` call sites in
`handoff_inject_lib`, `pre_qa_gate_gather_lib`, and `salvage_lib` through
`daemon-cycle-guard-lib/sh!`; wait-bound (exit 124) fails CLOSED with a
named finding via `acceptance_contract_gate_lib/evaluate`.

## Host / BL-149

All four production `.bb` files: **run** (ages 12–46d). Host quiet. No
Stryker (babashka). Gherkin + surgical this pass.

## Process fix this pass

`wait-bound-hit-result?` always-false survived because evaluate tests feed
`:wait-bound-hit?` directly. Added gather-lib unit asserts on the predicate
(exit 124 vs 0/1).

## BL-113 Gherkin (soft)

```
total=3 completed=3 killed=3 survived=0
outcome: pass
```

(Outline libraries only; plain scenarios covered by surgical.)

## Hand-authored surgical

| Mutant | Result |
|---|---|
| Drop wait-bound evaluate branch | killed |
| Wait-bound as fail-OPEN warning | killed |
| `wait-bound-hit-result?` always false | killed (after unit) |
| Parse wait-bound as nil | killed |
| Inject back to `process/sh` | killed |
| Salvage `sh-out` drops `:dir` | killed |

Survivors: 0.

## Verification

- Acceptance 7/7; acceptance-contract lib ALL PASS; guard ALL PASS
  (`spawn-only banned-API debt: []`)
- Gather acceptance-contract runner ALL PASS
- HOTFIX stamp-off matches board (`27273f2b0a`)

## Findings

NONE (after predicate unit lock).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1031-bounded-chokepoint-covers-the-spawn-reachable-subtree`.

By hardender.
