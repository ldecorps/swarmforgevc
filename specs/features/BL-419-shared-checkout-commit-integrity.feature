Feature: a commit on the shared master checkout carries the caller's own staged content

  # Twice, a coordinator stage-then-commit on the shared master checkout landed
  # stale content: `human_approval: approved` was staged, but `git show
  # <sha>:<path>` afterward read `pending`. Suspected race with concurrent
  # writers (high-frequency BL-topic-record commits, QA fast-forwards) grabbing
  # the shared index in the gap between `git add` and `git commit`. A commit must
  # reliably carry what its caller last staged for its own paths, or fail loudly.

  Background:
    Given a writer staging an edit to a path in the shared master checkout

  # BL-419 shared-checkout-commit-integrity-01
  Scenario: the committed content matches what the caller staged, despite a concurrent commit
    Given another process commits an unrelated path during the stage-to-commit window
    When the writer commits its staged edit
    Then git show of the new commit for the writer's path matches the staged content

  # BL-419 shared-checkout-commit-integrity-02
  Scenario: a post-commit mismatch is detected and retried before success is reported
    Given the committed content for the writer's path does not match what was staged
    When the writer verifies its commit
    Then it re-stages and re-commits within a bounded retry budget

  # BL-419 shared-checkout-commit-integrity-03
  Scenario: a mismatch persisting past the retry cap fails loudly rather than reporting success
    Given the committed content still does not match after the retry budget is exhausted
    When the writer finishes
    Then it surfaces the failure with a non-zero result and does not report the commit as successful
