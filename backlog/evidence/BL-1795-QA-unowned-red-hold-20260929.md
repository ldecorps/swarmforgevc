# BL-1795 - QA unowned-red hold, 2026-09-29

Parcel: documenter 3621f710ee, merged into QA as f3f4f29b70.
parcel_commit: f3f4f29b70

BL-1795's own gates are green; approval is withheld under Article 4.2
because the property lane carries one red file with no open owner. The
parcel does not touch that file; it is not bounced.

## Unowned red (no row in backlog/standing-reds.tsv, no open ticket)

red: extension/test/bl1052LocalModelSeat.property.test.js
  > BL-1052/BL-654: local-model seat invariants hold (bb property runner)
  Error: Test timed out in 20000ms.
  (test/bl1052LocalModelSeat.property.test.js:23:1; spawnSync('bb', [RUNNER]))
  Owner grep: only closed-ticket evidence (BL-1052, BL-1081, BL-1486) names it.
  Same shape as BL-1808's four subprocess-heavy files (fixed by
  propertyLaneTimeoutMs, landed 453077f16d); this one was not in its scope.
Plus 7x `[vitest-worker]: Timeout calling "onTaskUpdate"` (BL-871 allowlisted).

## BL-1795's own gates (all on f3f4f29b70, one run each)

- qa-sibling-check status: VERIFY BL-1795.
- pre_qa_gate.sh (required_wiring): OK.
- Unit (npm test): exit 0.
- Acceptance (BL-1795 feature): 3/3 ok.
- Stragglers: none of QA's before or after.

By QA.
