# BL-1599 — documenter send-back, 2026-09-16

## D1

- **Failing command**: `./swarmforge/scripts/swarm_handoff.sh ./tmp/handoff.txt` (send-time PRE_QA_GATE, `required_wiring` check)
- **Commit hash**: 751ed840c9 (documenter's own tip at send time; the wiring gap is unchanged from the received hardender commit 46c409305c)
- **First error excerpt**:
  ```
  PRE_QA_GATE_FAIL wiring BL-1599 extension/scripts/recordTestDuration.js
  does not contain "SUITE_WORK_BUDGET_MS" (npm test decides the work
  ratchet on every run - the live consumer (BL-1235))
  ```
- **Failure class**: behavior (a declared `required_wiring` anchor unmet)
- **Expected vs observed**: the ticket's own `required_wiring` names the
  literal `SUITE_WORK_BUDGET_MS` as required inside
  `extension/scripts/recordTestDuration.js` itself. The landed code is
  functionally correct (`buildSuiteWorkVerdict(workMs, forks, poleMs)` is
  called with no explicit budget/tolerance, so it resolves the constant's
  default value inside `check-suite-duration-budget.ts`) but never writes
  the literal string `SUITE_WORK_BUDGET_MS` inside `recordTestDuration.js`
  itself — same class of gap as BL-1607's send-back earlier today
  (`backlog/evidence/BL-1607-documenter-bounce-20260916.md`).
- **Blamed role**: coder (the wiring anchor's own file is coder-domain).
- **Remediation pointer**: `extension/scripts/recordTestDuration.js` — add
  a comment naming the literal `SUITE_WORK_BUDGET_MS` beside the
  `buildSuiteWorkVerdict` import/call (grep-satisfying, no behavior
  change), or pass the constant explicitly rather than relying on its
  default.

By documenter.
