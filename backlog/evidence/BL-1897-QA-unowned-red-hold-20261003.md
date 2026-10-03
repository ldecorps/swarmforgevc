# BL-1897 QA hold - unowned reds (Article 4.2)

parcel_commit: 98d6448c2c
task: BL-1897

Gate (qa-gather.js, one run): stragglers 0, sibling 0, register 0, wiring 0,
acceptance 0, unit 1, properties 1.

## Reds with NO open owner (hold the parcel)
red: extension/test/bl1529ScriptSenderAuditOutcomesInvariant.property.test.js
  verbatim: `Error: Test timed out in 120000ms.` (test at :140, "BL-1529 invariant: a challenge, a refusal, and a queue are three distinguishable outcomes")
red: extension/test/bl1892TerminatedLandNeverPushesLockless.property.test.js
  verbatim: `AssertionError: reach: {"pre-push":1,"repoint":9,"random":6,"group":10,"process":6,"beforeAnyPush":1,"midRepoint":9,"honoured":14}` (assert at :169, reach[k] >= 2)
  same file alone at 98d6448c2c: 1 passed (130 s) - sampled reach floor under full-lane load, not caused by this parcel.

Neither file is touched by the parcel; no active/paused/hold ticket names either.

## Red with an open owner
extension/test/stepHandlerModuleLoadBudget.test.js (unit lane) - BL-1659 (paused).

## Parcel's own checks
tmp/ untracked on the tip; ceilGitDiscoveryAtTmpdir wired via gitEnvGuardSetup.js
(setupFile of both lanes); acceptance green; no register row names BL-1897.
