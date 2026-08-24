# BL-1105 — hardener pass, 20260824

## Inbound

Merged architect `ba534ce559` into `swarmforge-hardender`.

## Scope

Corpus-level duplicate ticket-id refusal at mint in
`backlog_hygiene_lib.bb` / `specifier_backlog_hygiene_gate.bb` (local +
published corpora, fail-closed unreadable published).

## Host / cooldown

`mutation_cooldown_gate.bb`: **DECISION: run** on both `.bb` surfaces
(file_age ≥ cooldown; load quiet). No Stryker (babashka). Gherkin + surgical.

## BL-113 Gherkin (soft)

```
total=4 completed=4 killed=4 survived=0
outcome: pass
```

(Scenario Outline pools: paused/active/hold/done.)

## Hand-authored surgical

| Mutant | Result |
|---|---|
| fail-open published corpus error | killed |
| keep only peer dupes (drop corpus) | killed |
| never emit duplicate-id from corpus holders | killed |
| drop subject-peer-duplicates | killed (after harden) |
| index by basename instead of id | killed |

First pass: `drop-peer-duplicates` **survived**. Locked with unit assert
"two subjects claiming the same id in one run are refused even with empty
corpora"; recheck killed it.

Survivors after harden: 0.

## Verification

- Acceptance 8/8
- `backlog_hygiene_lib_test_runner.bb` ALL PASS (incl. peer-subjects case)

## Findings

NONE (one survivor killed by added regression assert).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1105-a-duplicate-ticket-id-is-refused-at-mint`.

By hardender.
