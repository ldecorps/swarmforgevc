Feature: BL-1867 a vitest run leaves no seed template behind

  `extension/test/helpers/sharedRepoFixture.js` (BL-1039) seeds one git
  repository per process and copies it for each caller. Its health check
  runs `git config core.worktree`, which exits 1 when the key is unset,
  so a healthy template reads as unhealthy and every copy seeds a new one.
  The reset also zeroes the seed counter, so `seedCount()` reports 1
  whatever the real number is. Each template is removed only on the
  process `exit` event, which a torn-down vitest worker never emits.
  Measured on 2026-10-01: one process copying 5 times left 5 templates,
  one unit test file of 11 tests left 11 behind, and `/tmp` held 445,231
  of them, about 76 GB and 18M inodes, growing by about 40,000 a day. A
  process now seeds one template, and a run leaves none behind.

  Background:
    Given an empty temp directory set as TMPDIR

  # BL-1867 five-copies-seed-one-template-01
  Scenario: copying the seeded repository five times in one process seeds one template
    When the process copies the seeded repository into 5 directories
    Then exactly 1 seed template is in the temp directory before the process exits
    And every copy is a git repository with exactly one commit on main

  # BL-1867 the-seed-count-tells-the-truth-02
  Scenario: the seed count reports a re-seeding after the template is found unhealthy
    When the process copies the seeded repository once, sets core.worktree in the template, and copies it again
    Then the helper's seed count is 2
    And every copy is a git repository with exactly one commit on main

  # BL-1867 a-vitest-run-leaves-no-template-behind-03
  Scenario: a vitest run of a file that copies the seeded repository leaves no seed template behind
    Given "test/applyCooldownPauseCli.test.js" still copies the seeded repository
    When "test/applyCooldownPauseCli.test.js" is run alone with the unit vitest config
    Then the run passes
    And the temp directory holds no entry whose name starts with "bl1039-seed-template-"
