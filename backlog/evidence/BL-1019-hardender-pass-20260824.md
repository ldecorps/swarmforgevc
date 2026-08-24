# BL-1019 — hardener pass, 20260824

## Inbound

Merged architect `4c312063da` into `swarmforge-hardender`.

## Scope

`./swarm status` liveness: session + agent-child under pane (not
`pane_current_command`); gather failure → `unknown`, never DOWN.
Pure `agent-liveness-verdict` in `swarm_status_lib.bb`.

## Host / cooldown

| File | Decision |
|---|---|
| `swarm_status_lib.bb` | **run** (~4.7d) |
| `swarm_status.bb` | **run** (~3.6d) |
| `agent_process_marker_lib.bb` | **skip-cooldown** (~0.65d) |

No Stryker (babashka). Gherkin + surgical.

## BL-113 Gherkin (soft)

```
total=2 completed=2 killed=2 survived=0
outcome: pass
```

(Outline: zsh / bash pane command.)

## Hand-authored surgical

| Mutant | Result |
|---|---|
| gather-fail → :down | killed |
| ignore agent child (never :up) | killed |
| missing session → :up | killed |
| always :up | killed |
| prefer legacy :alive? only | killed |

Survivors: 0.

## Verification

- Acceptance 5/5; `swarm_status_lib_test_runner.bb` ok

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1019-swarm-status-agrees-with-has-session`.

By hardender.
