# BL-754 — hardender pass, 20260824

## Inbound

Merged architect `a6318dbcf9` into `swarmforge-hardender`.

## Scope

`take-flow-reason-unquoted` / flow parse: unquoted comma inside a reason
→ `:malformed` (never silent drop); quote-style parity; simple unquoted
boundary before next `stage:` still OK. Observational — send still delivers.

## Host / cooldown

| File | Decision |
|---|---|
| `required_stages_lib.bb` | **run** (~24.8d) |
| `swarm_handoff.bb` | **skip-cooldown** (fresh) |

No Stryker (babashka). Surgical on the shared lib.

## BL-113 Gherkin (soft)

```
total=2 completed=2 killed=2 survived=0
outcome: pass
```

(Outline quote-style cells: double-quoted / single-quoted.)

## Hand-authored surgical

| Mutant | Result |
|---|---|
| silent first-comma split | killed |
| drop single-quote branch | killed |
| ignore malformed in parse loop | killed |
| flow-malformed clears msg | killed |
| else returns truncated reason | killed |
| never-accept unquoted boundary | killed |

Locked boundary with unit assert: unquoted `cleaner: no test, architect: covered`.

Survivors: 0.

## Verification

- Acceptance 5/5; `required_stages_test_runner.bb` ALL PASS

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-754-bl661-unquoted-flow-reason-silently-mis-parses-and-drops-stages`.

By hardender.
