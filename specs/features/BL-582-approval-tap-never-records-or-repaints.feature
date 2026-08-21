Feature: every approval tap produces an observable, durable outcome

  # BL-582. The 2026-07-23 14:05-14:12Z taps were served by a stale out/
  # build, and the 14:46:52Z supervisor recompile ended that window - the
  # second-poller theory is separately retracted
  # (FINDINGS-telegram-409-no-second-poller.md). But the stale build is NOT
  # a complete explanation and this file must not be read as saying it is.
  # Two taps have failed since that recompile: BL-588 the same evening
  # (~17:08Z, still pending with no uncommitted write), and BL-1026's tap on
  # 2026-08-21, tapped repeatedly during a front-desk poll-degraded/restart
  # storm with no yaml write and no inbound reply recorded. The verdict for
  # BL-1026 exists only because it was written by hand.
  #
  # What these scenarios gate is deliberately independent of that open
  # question: three hardening gaps that let ANY such failure be silent and
  # non-durable, whatever caused it. (a) a changed:false record returns with
  # no toast and no log, (b) the yaml write is uncommitted on a master
  # checkout that has demonstrably lost uncommitted work to other roles'
  # git churn, (c) a healthy bot on a stale build serves indefinitely
  # because the supervisor checks freshness only on crash respawn. Had (a)
  # existed on 2026-08-21, the BL-1026 tap would have said why it failed
  # instead of leaving the human tapping a dead button - which is the whole
  # point, and why closing the root-cause question is not a prerequisite
  # for any scenario below.

  # BL-582 approve-tap-records-and-repaints-01
  Scenario: an Approve tap on a tracked ask records the verdict and repaints
    Given a principal's Approve tap on a tracked ask
    When the callback is processed
    Then the ticket yaml records human_approval approved wherever it lives, active or paused
    And the ask's buttons are stripped and the verdict is shown

  # BL-582 record-and-repaint-independently-observable-02
  Scenario: a repaint failure after a successful record is reported, not swallowed
    Given the yaml record write for an Approve tap succeeded
    And the subsequent repaint attempt fails
    When the callback finishes processing
    Then the repaint failure is reported
    And the recorded verdict remains intact

  # BL-582 silent-no-op-is-now-observable-03
  Scenario Outline: every callback drop path emits a distinguishable diagnostic
    Given a callback tap that hits the <drop path> guard
    When the callback is processed
    Then a distinguishable diagnostic is emitted for <drop path>
    And the human-facing guards surface as a callback toast rather than silence

    Examples:
      | drop path         |
      | not-my-chat        |
      | not-principal       |
      | unrecognized-data   |
      | changed:false record |

  # BL-582 idempotent-repeat-tap-04
  Scenario: a tap on an already-recorded verdict stays idempotent and says so
    Given a ticket whose human_approval verdict is already recorded
    When the same principal taps Approve again on that ask
    Then no second write occurs
    And the response states the verdict is already recorded rather than doing nothing silently

  # BL-582 approval-write-commits-durably-05
  Scenario: an approval record write commits itself instead of leaving uncommitted state
    Given an Approve tap is being recorded on the master checkout
    When the yaml write completes
    Then the write is committed through the same commit-on-decision path used by expedite writes
    And a failed commit fails loudly rather than leaving an uncommitted record

  # BL-582 stale-build-cannot-serve-indefinitely-06
  Scenario: a healthy bot on a stale build is restarted beyond a grace period, not only on crash
    Given the front-desk bot is healthy but running a build older than the grace period
    When the supervisor's healthy-tick check runs
    Then the bot is restarted onto a fresh build
    And this does not require a crash to trigger

  # BL-582 bot-stdout-survives-failure-window-07
  Scenario: the silent-drop diagnostic lands in a log that survives the failure window
    Given a callback drop diagnostic was just emitted
    When the failure window ends
    Then the diagnostic is present in a log file that was not lost with the process
