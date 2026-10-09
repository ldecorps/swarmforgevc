Feature: BL-2091 A hardener whose mutation run is under way gets a longer seat-stuck clock

  Babysitter's seat-stuck CRIT (check 5b) fires when a seat has held a
  ticket 60 minutes with no commit of its own naming it, and the
  coordinator answers it by pulling the ticket and restarting the seat
  (the BAU of 5b277c03cd). The human set 60 minutes on 2026-10-05 (hotfix
  9b4ccdd827). A hardener gate on a mutation-heavy ticket runs Stryker,
  then CRAP, then jscpd, then commits, so it makes no commit for the
  length of the run by design: BL-2061's hardener pass on 2026-10-08 ran
  about 142 minutes and drew the CRIT twice (61m at 14:21Z, 91m at
  14:51Z) while its mutation progress file showed a healthy run.

  The human ruled on 2026-10-08 that the clock becomes stage-aware: a
  longer clock for the hardener's mutation gate, and 60 minutes for every
  other seat. The longer clock applies only while the hardener's own
  mutation progress file has been written since the hold's progress
  origin (the claim, or the seat's last own commit for the ticket), which
  proves a run began during this hold. The loop-dialog and REPEAT-note
  triggers are unchanged for every seat.

  Background:
    Given a seat holding a ticket with no commit since its claim

  # BL-2091 a-mutating-hardener-is-not-stuck-at-91-minutes-01
  Scenario: a hardener whose mutation run began during the hold is not stuck at 91 minutes
    Given the seat is the hardender
    And the seat's mutation progress file was written after the claim
    And the hold is 91 minutes old
    When babysitter sweeps
    Then it raises no seat-stuck CRIT for that seat

  # BL-2091 the-clock-follows-the-stage-and-the-run-02
  Scenario Outline: the seat-stuck CRIT fires at the clock the seat's stage and mutation run earn
    Given the seat is the <role>
    And the seat's mutation progress file was written <when> the claim
    And the hold is <minutes> minutes old
    When babysitter sweeps
    Then it raises the seat-stuck CRIT for that seat, naming a <minutes>m threshold

    Examples:
      | role      | when   | minutes |
      | hardender | after  | 150     |
      | hardender | before | 60      |
      | coder     | after  | 60      |
