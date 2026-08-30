# `test_front_desk_supervisor_liveness.sh` decides its stall checks by racing a
# real clock. `stamp_own_heartbeat_then_age_past_stall` writes a heartbeat, then
# sleeps `FRONT_DESK_STALL_MS + 300ms` (line 65) and assumes the next
# `--check-once` subprocess lands inside that fixed cushion. Nothing enforces
# the assumption: every check spawns a real `bb` process, the fixture spawns
# real Node children, and a loaded host schedules none of it on the fixture's
# terms.
#
# Measured 2026-08-30. On an idle host the fixture is 3/3 green (14 checks,
# all passing). Under the load of a full acceptance run QA reproduced it twice,
# with a DIFFERENT set of checks red each time:
#   run A (inside acceptance)  "the bot transitions to stalled"
#   run B (bare rerun)         front-desk-liveness-01, the bridge check,
#                              and the stall-logged check
# Different checks failing each time is the signature of a scheduling race, not
# of a logic defect. `git show 501dedf09` confirms BL-1279 changed only the
# `make_fixture` copy/load-guard lines; the check bodies and their cushion are
# byte-identical to before. Because this fixture died at load 100% of the time
# until BL-1279 repaired its copy-list, the race was structurally unobservable
# - newly EXPOSED, never newly introduced.
#
# The cost is not one flaky file. Three acceptance features grep this
# fixture's PASS lines and go red with it:
#   specs/features/BL-370-front-desk-liveness-means-listening.feature
#   specs/features/BL-1089-the-front-desk-liveness-suite-gates-the-guarantee-it-names.feature
#   specs/features/BL-1279-front-desk-fixtures-derive-their-bb-closure.feature (scenario 03)
# A red that appears and disappears with host load is a red reviewers learn to
# dismiss, and a dismissed red is an unowned defect.
#
# The property wanted is that no check's verdict depends on how much wall-clock
# time elapsed between the fixture's setup and the supervisor's read of it -
# each verdict must hold for ANY non-negative delay. Injecting a delay is how
# that property is gated here without loading the host.

Feature: The front-desk liveness fixture's verdicts do not race the wall clock

  Background:
    Given the standing test "swarmforge/scripts/test/test_front_desk_supervisor_liveness.sh"

  # BL-1285 liveness-fixture-does-not-race-the-wall-clock-01
  Scenario Outline: a host slow to schedule the fixture does not change its verdict
    Given an extra delay of <delay_ms> ms before every supervisor check the fixture makes
    When the fixture runs
    Then the run exits zero and reports no failed check

    Examples:
      | delay_ms |
      | 0        |
      | 1500     |
      | 4000     |

  # BL-1285 liveness-fixture-does-not-race-the-wall-clock-02
  Scenario: a delayed run reports the same checks, never fewer
    Given an extra delay of 4000 ms before every supervisor check the fixture makes
    When the fixture runs
    Then it reports the same named checks as a run with no extra delay

  # BL-1285 liveness-fixture-does-not-race-the-wall-clock-03
  Scenario: the fixture still fails when the supervisor stops detecting stalls
    Given a scratch copy of the supervisor whose stall detection never reports a stall
    And an extra delay of 4000 ms before every supervisor check the fixture makes
    When the fixture runs against that scratch copy
    Then the run exits non-zero and names a failed stall check
