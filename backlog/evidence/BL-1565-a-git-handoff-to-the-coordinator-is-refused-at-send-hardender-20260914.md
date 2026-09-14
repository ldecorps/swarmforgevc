# BL-1565-a-git-handoff-to-the-coordinator-is-refused-at-send — hardender review pass, 2026-09-14

1 defect(s) found. One bounce, complete inventory (Article 4.4).

## D1

- **Failing command**: npx vitest run test/socketFixtureShortRootGuard.test.js (whole-tree standing guard sweep)
- **Commit hash**: 60975202ab
- **First error excerpt**: expected zero socket-fixture-root violations under specs/pipeline/steps, found: bl1565CoordinatorNeverReceivesGitHandoffSteps.js: builds or references a control socket but roots its fixture at os.tmpdir()
- **Failure class**: test-infrastructure
- **Expected vs observed**: fixture rooted via lib/socketFixtureRoot.js mkSocketFixtureRoot per BL-948
- **Blamed role**: coder
- **Remediation pointer**: switched initFixture to mkSocketFixtureRoot, shortened FIXTURE_PREFIX, pointed the BL-971 pre-run sweep at SHORT_FIXTURE_BASE

By hardender.
