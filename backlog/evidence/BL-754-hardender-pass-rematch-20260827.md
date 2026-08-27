# BL-754 — hardender pass rematch — 20260827

## Inbound

Merged architect `85cc55e815` into `swarmforge-hardender` (merge commit
`687133c33`; pre-merge hook required BL-545 retirement note in message).

## Scope

`take-flow-reason` / `parse-flow-skip-reasons`: single-quote parity; unquoted
interior comma → `:malformed`; observational handoff path. Rematch re-entry on
tip — same BL-754 core as prior pass 20260824.

## Merge breakage fixed

Architect merge left `specs/pipeline/steps/index.js` requiring
`bl1155PipelineBoardGridHeaderOneLineSteps.js` while the file was absent from
the line (BL-1155 done on `main`). Restored steps module from `main` so the
acceptance runner can load.

## Host / cooldown

| File | Decision |
|---|---|
| `required_stages_lib.bb` | **run** (~24.8d) |
| `swarm_handoff.bb` | **skip-cooldown** (fresh) |

No Stryker (babashka). Surgical on the shared lib.

## BL-113 Gherkin (soft)

```
total=0 skipped=2 (soft reuse — manifest still reports killed=2 survived=0)
outcome: pass
```

Manifest refreshed `tested_at` on rematch run.

## Hand-authored surgical

| Mutant | Result |
|---|---|
| silent first-comma split | killed |
| drop single-quote branch | killed |
| ignore malformed in parse loop | killed |
| flow-malformed clears msg | killed |
| unquoted returns truncated reason | killed |
| never-accept unquoted boundary | killed |

Survivors: 0. Skipped: 0.

## Verification

- Acceptance BL-754 feature: **5/5**
- `required_stages_test_runner.bb`: ALL PASS

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-754-bl661-unquoted-flow-reason-silently-mis-parses-and-drops-stages`.

By hardender.
