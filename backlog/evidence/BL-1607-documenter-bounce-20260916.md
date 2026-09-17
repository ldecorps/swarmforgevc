# BL-1607 — documenter send-back, 2026-09-16

## D1

- **Failing command**: `./swarmforge/scripts/swarm_handoff.sh ./tmp/handoff.txt` (send-time PRE_QA_GATE, `required_wiring` check)
- **Commit hash**: 5ea3e31b57 (documenter's own tip at send time; the wiring gap is unchanged from the received hardender commit 5d82922202)
- **First error excerpt**:
  ```
  PRE_QA_GATE_FAIL wiring BL-1607 extension/vitest.config.mjs does not
  contain "SWARMFORGE_UNIT_LANE_FORKS" (the lane config that runs on
  every npm test is the producer of the fork count the factor reads;
  without this line the factor is load-only on every run)
  ```
- **Failure class**: behavior (a declared `required_wiring` anchor unmet)
- **Expected vs observed**: the ticket's own `required_wiring` FIRMly
  names the literal string `SWARMFORGE_UNIT_LANE_FORKS` as required inside
  `extension/vitest.config.mjs` itself — precisely so a text scan proves
  the fork-count producer is wired without executing code (BL-1235's
  caution, quoted in the ticket: "without this line the factor is
  load-only on every run"). The landed code is functionally correct but
  never writes that literal in this file: `vitest.config.mjs` imports the
  symbol `UNIT_LANE_FORKS_ENV_KEY` from `unitLaneContentionBudget.js` and
  writes `process.env[UNIT_LANE_FORKS_ENV_KEY] = ...` — the actual string
  `'SWARMFORGE_UNIT_LANE_FORKS'` is a literal only inside
  `unitLaneContentionBudget.js`, never inside `vitest.config.mjs`. The
  send-time gate does a literal grep per the ticket's own anchor spec and
  correctly finds it absent.
- **Blamed role**: coder (the wiring anchor's own file is coder-domain;
  this is not a documentation defect — I cannot edit `extension/vitest.config.mjs`
  or test-infra config from this role).
- **Remediation pointer**: `extension/vitest.config.mjs` — either add a
  comment naming the literal `SWARMFORGE_UNIT_LANE_FORKS` beside the
  `UNIT_LANE_FORKS_ENV_KEY` import/assignment (grep-satisfying, no
  behavior change), or otherwise satisfy the ticket's own required_wiring
  line without duplicating the key's value as a second hardcoded literal.

By documenter.
