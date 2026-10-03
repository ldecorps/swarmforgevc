# BL-1891 QA hold - unowned red (Article 4.2)

parcel_commit: 4fdaa689f3
task: BL-1891

BL-681 acceptance: 3 of 3 ok. Parcel diff: evidence + one comment in
bl681ConsolidationNeverDropsHumanSentenceSteps.js. No register row names BL-1891.

## Unit lane (one run, load avg ~12): 1 failed | 11018 passed
red: extension/test/stepHandlerModuleLoadBudget.test.js
  verbatim: `aDroppedMessageMustNotParkTheOffsetSteps.js: incremental require cost 635.8ms exceeds the 400ms budget (confirmed alone)`
  No open ticket names aDroppedMessageMustNotParkTheOffsetSteps (BL-1659 owns the same guard
  file for node:test-at-load, not this handler's require cost). Parcel does not touch it.

Also reported by the run (lane gate, not test failures): per-file budget over for
confirmPoleAloneOutcomeShapes (BL-1893 active), pausedPagerBridge, pwaDashboard,
stepHandlerModuleLoadBudget; `suite work REFUSED: 856.3s work (budget 550.0s, 7 forks)`.
