# BL-941 — hardener pass — 20260827

## Inbound

Architect `edf178732e` after cleaner `e1f0e26fdf`.

## Gates

| Gate | Result |
|---|---|
| Compile | **PASS** |
| Unit `telegramCursorBridgeCore.test.js` | **124/124** |
| Properties `bl941CursorGoneAgentClassifierInvariants.property.test.js` | **3/3** |
| Acceptance | **5/5** |
| Gherkin soft | **pass** (4/4 outline mutants killed) |
| Surgical `bl941_gone_agent_classifier_mutation_sweep.sh` | **4/4 killed** |
| Stryker (`mutation_cooldown_gate.bb`) | **skip-cooldown** (file_age 0.03d < 3d window) — per BL-149, no override; surgical sweep + property tests cover classifier boundaries |
| CRAP `isCursorAgentGone` | **1.00** (CC=1, 100% cov) |
| CRAP `shouldResetCursorAgentSession` | **4.00** (CC=4, 100% cov) |

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-941-bl915-owed-mutation-and-crap-gates`.

By hardender.
