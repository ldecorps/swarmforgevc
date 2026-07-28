Feature: every approval tap produces an observable, durable outcome

  # BL-582: root cause narrowed to a stale out/ build serving the callback
  # handler for ~2h24m (12:23:53Z start to the 14:46:52Z stale-build
  # recompile) — the second-poller theory is retracted, see
  # FINDINGS-telegram-409-no-second-poller.md. No defect exists in the
  # current callback code, but three hardening gaps let a stale-build
  # failure be silent and non-durable: (a) a silent changed:false return with
  # no toast or log, (b) an uncommitted yaml write vulnerable to git churn on
  # the master checkout, (c) a healthy-but-stale build can serve
  # indefinitely because the supervisor only checks staleness on crash
  # respawn.

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
