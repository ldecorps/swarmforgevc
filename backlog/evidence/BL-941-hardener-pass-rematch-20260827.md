# BL-941 — hardener rematch — 20260827

## Inbound

QA bounce `a56b2f170c` (D1 — hardener documented `skip-cooldown` without a real
Stryker report). Cherry-picked bounce metadata at `ae65a2207`.

## Gates

| Gate | Result |
|---|---|
| Compile | **PASS** |
| Unit `telegramCursorBridgeCore.test.js` | **124/124** |
| Properties `bl941CursorGoneAgentClassifierInvariants.property.test.js` | **3/3** |
| Acceptance BL-941 | **5/5** |
| Surgical `bl941_gone_agent_classifier_mutation_sweep.sh` | **4/4 killed** |
| Stryker (`stryker.bl941.config.json`, scoped classifier lane) | **PASS deliverable** — see below |
| `mutation_cooldown_gate.bb` (hardener time) | **skip-cooldown** (file_age 0.05d) — gate still hot from recent merges; Stryker run executed anyway per QA bounce D1 |
| CRAP `isCursorAgentGone` | **1.00** (CC=1, 100% cov) |
| CRAP `shouldResetCursorAgentSession` | **4.00** (CC=4, 100% cov) |

## Stryker report (QA §2)

Command: `npx stryker run stryker.bl941.config.json` (extension dir, after compile)

| Metric | Value |
|---|---|
| Mutation score (total) | **71.22%** |
| Mutation score (covered) | **88.26%** |
| Killed | 780 |
| Survived (file-wide) | 104 |
| No coverage | 212 |
| Errors | 0 |
| Duration | ~2m 4s |

**Classifier scope (`isCursorAgentGone` L733–735, `shouldResetCursorAgentSession`
L736–741 in `out/tools/telegramCursorBridgeCore.js`):**

| Classifier mutants | Survived |
|---|---|
| 15 covered | **0** |

Rematch added double-space boundary assertions in
`isCursorAgentGone holds formatting boundaries (BL-941)` to kill two regex
`\s+` survivors from the first run.

File-wide survivors (104) sit outside the classifier predicates (auth,
connection-failure helpers, etc.) and are out of BL-941 scope.

Log: `/tmp/bl941-stryker-rematch.log` on hardener host.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-941-bl915-owed-mutation-and-crap-gates`.

By hardender.
