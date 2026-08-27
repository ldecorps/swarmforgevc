# BL-1070 — hardender pass, 20260824

## Inbound

Merged architect `d453cb30ca` into `swarmforge-hardender`.

## Scope

`agent-process-line` matches any descendant under the pane (BFS), not only
direct children; scoped to that pane's tree. RC check reports UNAVAILABLE
when liveness unmet.

## Host / cooldown

| File | Decision |
|---|---|
| `agent_process_marker_lib.bb` | **skip-cooldown** |
| `babysitterd_sweep_lib.bb` | **skip-cooldown** |

## BL-113 Gherkin (soft)

```
total=14 completed=14 killed=14 survived=0
outcome: pass
```

## Hand-authored surgical

| Mutant | Result |
|---|---|
| direct-child-only descendant set | killed |
| match any claude globally | killed |
| empty under-pane set | killed |
| never match marker | killed |

Survivors: 0.

## Verification

- Acceptance 9/9; agent_process_marker + babysitterd_sweep units OK

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1070-pane-liveness-misses-a-claude-below-the-first-generation`.

By hardender.
