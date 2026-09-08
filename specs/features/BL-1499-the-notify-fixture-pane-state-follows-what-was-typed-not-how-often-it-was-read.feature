Feature: BL-1499 The notify fixture's pane state follows what was typed, not how often it was read

  test_handoffd_notify_verified.sh drives the real verified wake against a
  fake tmux whose capture-pane reply was sequenced by call count: the first
  read returned the idle pane and every later read the scenario's post-typing
  pane. Since 2026-07-22 the startup-notify path probes the pane for busyness
  before the wake's own pre-inject check, so the second probe read the stuck
  wake text as pre-existing input and the daemon never typed - case 02 has
  been red since. This feature is that the fixture's pane content is a
  function of what has been typed into it, so any number of probes before
  the literal send see the idle pane, and BL-093's lost-Enter contract is
  asserted again on main.

  Background:
    Given the notify test's fixture as it stands on the tree

  # BL-1499 lost-enter-case-types-once-under-any-number-of-pre-typing-probes-01
  Scenario: the wedged-pane case types the wake exactly once, retries the submit and logs the failure
    When the notify test runs against the real startup-notify path
    Then it reports the wedged-pane case as passed
    And its daemon log for that case names a delivery failure and no second typed copy

  # BL-1499 the-file-exits-zero-from-the-checkout-it-runs-in-02
  Scenario: the notify test passes every case against the real startup-notify path as it stands
    When the notify test runs against the real startup-notify path
    Then it exits zero
    And it reports every case as passed
