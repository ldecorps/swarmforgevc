Feature: BL-1640 A finish-shift sleep runs the closing ceremony to its end before the stack stops

  finish-shift declares itself a sleep to the closing ceremony CLI and then
  stops the stack on the next line. The CLI is one tick of a state machine
  whose later ticks the daemon drives, and the daemon dies seconds later;
  the tick also computes its hard deadline from the morning stop time, so
  at an afternoon bedtime the deadline has already passed. On 2026-09-18 the
  bedtime froze promotion and killed everything four seconds later - no lean
  packet, no documenter instruction. After this parcel a sleep advances the
  ceremony until its state reads done, its deadlines are relative to the
  sleep itself, a second sleep the same day after a shift of work is a new
  ceremony, and bedtime still never hangs.

  Background:
    Given a fixture root under a temporary directory with a daemon-shaped .swarmforge and no tmux server
    And swarmforge.conf sets closure_stop_local to "08:45" with a drain budget of 2 minutes and a briefing budget of 1 minute
    And finish-shift's stop steps and its tick interval are driven through the test seams

  # BL-1640 a-sleep-reaches-done-before-any-stop-01
  Scenario: a sleep with in-flight work reaches done before any stop-set component is stopped
    Given one in-process parcel on a worktree role
    And the swarm worked a shift since the last ceremony
    And today's briefing is not recorded as sent
    When the swarm is put to sleep through finish-shift
    Then the ceremony state reads done before the babysitterd stop runs
    And the recorded sequence contains "lean-packet" and the documenter is instructed to produce the morning briefing
    And the swarm is stopped

  # BL-1640 a-briefing-that-lands-inside-the-budget-ends-the-ceremony-cleanly-02
  Scenario: a briefing recorded as sent between ticks ends the ceremony with send-confirmed rather than briefing-missing
    Given no in-process parcel
    And the swarm worked a shift since the last ceremony
    And today's briefing is recorded as sent after the documenter instruction is queued
    When the swarm is put to sleep through finish-shift
    Then the recorded sequence ends with "briefing-committed, send-confirmed, swarm-stopped"
    And "closing-briefing-missing" is not surfaced

  # BL-1640 deadlines-are-relative-to-the-sleep-03
  Scenario: a sleep at 16:00Z anchors its deadlines to now plus the budgets, never to the morning stop time
    Given the sleep starts at 16:00Z
    And the swarm worked a shift since the last ceremony
    When the sleep path starts a new ceremony
    Then the state's drainDeadlineMs and hardDeadlineMs equal the start time plus 2 and 3 minutes respectively
    And the freeze written for promotion lasts until that hardDeadlineMs

  # BL-1640 a-second-sleep-after-a-worked-shift-is-a-new-ceremony-04
  Scenario: a second sleep on the same day after a shift of work starts a new ceremony
    Given a ceremony state for today that already reads done
    And the swarm worked a shift since the last ceremony
    When the swarm is put to sleep through finish-shift
    Then the state's startedAtMs is the new sleep's time
    And the recorded sequence begins again with "freeze-promotion"

  # BL-1640 a-second-sleep-with-no-shift-stays-quiet-05
  Scenario: a second sleep on the same day with no shift since stays a no-op
    Given a ceremony state for today that already reads done
    And the swarm worked no shift since the last ceremony
    When the swarm is put to sleep through finish-shift
    Then the ceremony state is unchanged
    And no note is queued for any role

  # BL-1640 bedtime-never-hangs-06
  Scenario: a ceremony that never reads done is stopped at the ceiling and the overrun is said out loud
    Given the ceremony CLI is replaced through its seam by one that never reports done
    When the swarm is put to sleep through finish-shift
    Then the stack is stopped once the drain, briefing and grace budgets have all passed
    And finish-shift reports that the closing ceremony overran its budgets
    And finish-shift exits with status 0
