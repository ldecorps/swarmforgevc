# BL-988 hardener pass — orphaned WSL acceptance binding — 20260825

**QA bounce4 tip:** `6aba034ed` / handoff `3ab4c010e6` (use bounce4 on live main)
**Product rematch:** documenter `1ba588ff06` onto live `origin/main`
**Task:** `BL-988-orphaned-wsl-acceptance-contract-has-no-step-handlers`

## Tip purity

`git reset --hard origin/main` → rematch BL-988 product + bounce evidence.
Authorize **BL-988 paths only**. **0 deletes.** Keep JumpQ + QA bounce
evidence per bounce4 remediation.

## Product surface

RESTORE decision: BL-578 handlers stay registered; binding property
`bl988Bl578ContractBinding.property.test.js` is the load-bearing gate.

## Gates

| Gate | Result |
|------|--------|
| `bl988Bl578ContractBinding.property.test.js` | 2/2 |
| APS BL-578 feature | 7/7 |
| Soft Gherkin | `outcome: fail` (2/2 survived) — not a pass |
| Surgical (6) | killed=6 survived=0 skipped=0 |
| BL-149 | binding property `run`; BL-578 steps `skip-cooldown` |

## Soft → surgical (BL-638 / BL-234)

Outline Example path mutants (case-flip + spaced-path prefix) **SURVIVED** as
**BL-234 equivalents**: the example value is threaded into both
`buildWindowsKillOldCommands` and `blob.includes(extPath)` — both sides move
together; no assertion can differentiate. Host case probe
(`touch CoDeR` / `ls coder`) failed → volume is case-sensitive; survival is
still equivalence of the threaded fixture, not host-masking.

Hand surgical locked index registration, registerSteps call, feature name,
step floor, resolve result, and FEATURE_PATH.

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-988 only.

By hardender.
