# BL-1696 - QA hold on an unowned red (Article 4.2), 2026-09-24

Parcel commit: b9410ccd73 ("Merge documenter 43945dd0de into QA.")
Red path: extension/test/stepHandlerModuleLoadBudget.test.js

BL-1696 does not touch this file. Its standing-red row, owned by BL-1687,
was retired when BL-1687 landed at aa41de4286 (REGISTER_ROW_RETIRED), so
the red has no open owner (qa-gather register_join: "absent"). The parcel
waits for an owner. This is not a bounce.

Command: `npm test` (extension/), one run via qa-gather.js at b9410ccd73,
host load average about 10 during the run.

Verbatim failures:

1. `the module-load budget guard runs the require census over every real step handler ...`
   `AssertionError: module-load budget violation(s):`
   `  bl709BubbleItsOwnTelegramTopicSteps.js: incremental require cost 530.7ms exceeds the 400ms budget (confirmed alone)`
   (test/stepHandlerModuleLoadBudget.test.js:81)

2. `checkHandlerBudgets non-vacuity: a fixture handler that lists a directory at module load is named, never silently passed`
   `AssertionError: expected exactly one violation, got: [{"file":"zzzFixtureOffenderSteps.js","reason":"lists a directory at module load"},{"file":"zzzFixtureOffenderSteps.js","reason":"incremental require cost 417.0ms exceeds the 400ms budget (confirmed alone)"}]`
   (test/stepHandlerModuleLoadBudget.test.js:157)

Mechanism, as read and not re-run: the test sets an absolute 400ms wall-clock
budget. The second failure's fixture is trivial and still measured 417ms, so
the budget is not relative to host load. BL-1687's own bl709 fix is also
still over budget on this host.

BL-1696's own gates in the same pass: property suite green; acceptance
(run_acceptance.sh on the BL-1696 feature) green; pre_qa_gate OK;
qa-sibling-check VERIFY; qa_e2e steps 2 and 3 pass by hand.

By QA.
