# BL-1904 QA hold - unowned reds (Article 4.2)

parcel_commit: ee5853ec52
task: BL-1904

## Parcel's own checks (all green)
- BL-1904 feature: 4 of 4 ok. BL-1871 feature 9/9, BL-1887 feature 4/4,
  parcel_line_lib_test_runner.bb ALL PASS (its "moved swarmforge-coder onto b678b993c7"
  is a fixture repo: b678b993c7 is not an object in the live repo, no new live backup ref).
- docs/how-to/BL-1871-parcel-line-take-up.md:63 lists the new "not taken up there" refusal.
- No register row names BL-1904. Stragglers before/after: none.
- Not yet run: qa_e2e step 3 (scratch-clone incident replay) - deferred to the resume.

## Reds (qa-gather, one run; none in a file the parcel touches)
red: extension/test/stepHandlerModuleLoadBudget.test.js
  verbatim: `aDroppedMessageMustNotParkTheOffsetSteps.js: incremental require cost 787.1ms exceeds the 400ms budget (confirmed alone)`
  (same red as BL-1891's hold; no open owner)
red: extension/test/bl1529ScriptSenderAuditOutcomesInvariant.property.test.js
  (same red as BL-1897's hold, `Error: Test timed out in 120000ms.` there; message not in this run's excerpt)
red: extension/test/telegramFrontDeskBotCli.property.test.js
  register_join: absent; failure message not in the gather's 4000-char excerpt and the lane is
  not re-run (one-run rule). Named by BL-1596 (paused, bare per-test timeouts) and BL-791 - owner unconfirmed.
