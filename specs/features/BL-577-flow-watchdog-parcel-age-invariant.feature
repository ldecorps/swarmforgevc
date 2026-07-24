Feature: flow watchdog alarms on any parcel aged past threshold in any mailbox

  # BL-577 flow-watchdog-parcel-age-invariant-01
  Scenario Outline: an over-threshold parcel in a dormant role's inbox alarms while every liveness signal reads green
    Given a <type> parcel aged past the warn threshold sits in dormant role cleaner's inbox/new
    And every liveness signal for cleaner reads healthy
    When the flow watchdog sweep runs
    Then exactly one Telegram alarm is emitted for that parcel
    And the alarm names the parcel id, from role, to role, type, age, holding mailbox, and an unblock verb

    Examples:
      | type                |
      | git_handoff         |
      | note                |
      | broadcast note copy |

  # BL-577 flow-watchdog-parcel-age-invariant-02
  Scenario: repeated sweeps within one tier never repeat the alarm
    Given a parcel already alarmed at the warn tier
    And the parcel has not aged past the escalate threshold
    When the flow watchdog sweep runs
    Then no new alarm is emitted for that parcel

  # BL-577 flow-watchdog-parcel-age-invariant-03
  Scenario: crossing the escalate tier re-alarms exactly once
    Given a parcel already alarmed at the warn tier
    When the parcel ages past the escalate threshold
    And the flow watchdog sweep runs twice
    Then exactly one escalate-tier alarm is emitted for that parcel

  # BL-577 flow-watchdog-parcel-age-invariant-04
  Scenario Outline: a parcel that progresses never alarms again
    Given a parcel already alarmed at the warn tier
    When the parcel is <progress>
    And the flow watchdog sweep runs
    Then no new alarm is emitted for that parcel

    Examples:
      | progress  |
      | claimed   |
      | completed |
      | reaped    |

  # BL-577 flow-watchdog-parcel-age-invariant-05
  Scenario: the alarm decision is structurally unable to suppress by role, type, or dormancy
    Given the flow watchdog's tier decision function
    Then its inputs carry only parcel age, thresholds, prior alarmed tier, and snooze state
    And no role, type, or dormancy field reaches the decision

  # BL-577 flow-watchdog-parcel-age-invariant-06
  Scenario: an old-header fresh-mtime parcel alarms
    Given a parcel in a role's inbox/new whose enqueued_at header is older than the warn threshold and whose file mtime is fresh
    When the flow watchdog sweep runs
    Then a warn-tier alarm is emitted for that parcel

  # BL-577 flow-watchdog-parcel-age-invariant-07
  Scenario: a fresh-header old-mtime parcel does not alarm
    Given a parcel in a role's inbox/new whose enqueued_at header is fresher than the warn threshold and whose file mtime is old
    When the flow watchdog sweep runs
    Then no new alarm is emitted for that parcel

  # BL-577 flow-watchdog-parcel-age-invariant-08
  Scenario Outline: coverage spans master-resident and worktree mailboxes, new and in_process
    Given an over-threshold parcel sits in the <mailbox> mailbox
    When the flow watchdog sweep runs
    Then an alarm is emitted naming the <mailbox> mailbox as the holder

    Examples:
      | mailbox                                      |
      | master-resident specifier inbox/new          |
      | master-resident coordinator inbox/in_process |
      | worktree cleaner inbox/new                   |
      | worktree QA inbox/in_process                 |

  # BL-577 flow-watchdog-parcel-age-invariant-09
  Scenario Outline: the 2026-07-23 incidents replayed as fixtures each alarm within one sweep
    Given the <incident> fixture with its parcel aged just past the warn threshold
    When the flow watchdog sweep runs
    Then an alarm is emitted for that parcel prescribing <verb>

    Examples:
      | incident                                  | verb        |
      | wake-budget-starved architect git_handoff | rotate      |
      | ten-hour dead-lettered specifier note     | rotate      |
      | unforwarded cleaner in_process parcel     | investigate |

  # BL-577 flow-watchdog-parcel-age-invariant-10
  Scenario: thresholds come from the effective config
    Given the effective config sets flow_watchdog_warn_ms to 60000
    And a parcel aged 90000 ms sits in a role's inbox/new
    When the flow watchdog sweep runs
    Then a warn-tier alarm is emitted for that parcel

  # BL-577 flow-watchdog-parcel-age-invariant-11
  Scenario: malformed config falls back to defaults and never disables the watchdog
    Given the effective config's flow watchdog lines are malformed
    And a parcel aged past the default warn threshold sits in a role's inbox/new
    When the flow watchdog sweep runs
    Then a warn-tier alarm is emitted for that parcel

  # BL-577 flow-watchdog-parcel-age-invariant-12
  Scenario: a per-parcel snooze mutes only the snoozed parcel and is visible state
    Given two over-threshold parcels where exactly one carries a snooze entry in the watchdog state file
    When the flow watchdog sweep runs
    Then only the unsnoozed parcel alarms
    And the snooze entry remains readable in the watchdog state file

  # BL-577 flow-watchdog-parcel-age-invariant-13
  Scenario: an unconfirmed alarm write is retried, never silently recorded as sent
    Given an over-threshold parcel and an alarm channel whose write fails or is uncertain
    When the flow watchdog sweep runs
    Then the parcel's tier is not recorded in the watchdog state file
    And a subsequent sweep re-attempts the alarm for that parcel
    But once the alarm channel confirms the write, the tier is recorded and no further re-attempt occurs
