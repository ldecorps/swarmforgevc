Feature: BL-1479 A ticket that cannot advance does not hold an active slot

  active_backlog_max_depth is enforced by counting every ticket YAML in
  backlog/active/ (backlog_depth_lib.bb count-active-tickets). Nothing moves
  a ticket back out once it is there, so a ticket that becomes unworkable
  while active keeps its slot for as long as nobody notices. On 2026-09-07
  BL-940 had held one of five slots for a day, status: blocked on a
  dependency paused at priority 96, and BL-1441 another for two days,
  promoted with a note saying it could not start before 09-08, while some
  thirty approved, unblocked tickets waited in paused/. status: blocked only
  stops auto-promotion (BL-1145) and silences the dropped-parcel nag
  (BL-1301); a future not_before (BL-1469) only refuses promotion. This
  feature is that a sweep parks such a ticket back to paused/ with its YAML
  byte-identical, frees the slot, tells the coordinator once, and never
  touches a ticket whose parcel is anywhere in the pipeline.

  Background:
    Given a fixture backlog under a scratch root with an active depth cap of 2
    And the park sweep's clock, mailbox listing, log and commit seams are injected

  # BL-1479 a-ticket-that-cannot-advance-does-not-hold-a-slot-01
  Scenario Outline: an active ticket that cannot advance is parked with its YAML untouched
    Given an active ticket with no parcel in any mailbox that <condition>
    When the park sweep runs
    Then the ticket is in backlog/paused/ and not in backlog/active/
    And its YAML is byte-identical to before the park
    And the coordinator receives one note naming the ticket and <condition>
    And the active count is one below the cap

    Examples:
      | condition                                        |
      | declares status: blocked                         |
      | declares a not_before later than the sweep's day |

  # BL-1479 a-ticket-that-cannot-advance-does-not-hold-a-slot-02
  Scenario: a ticket whose parcel is in a mailbox is never parked, whatever its status
    Given an active ticket declaring status: blocked whose task name is in a role's in_process mailbox
    When the park sweep runs
    Then the ticket stays in backlog/active/
    And the log records that the park was refused because a parcel is in flight
    And no note is sent

  # BL-1479 a-ticket-that-cannot-advance-does-not-hold-a-slot-03
  Scenario: a ticket that can advance is left alone
    Given an active ticket with status todo and a not_before equal to the sweep's day
    When the park sweep runs
    Then the ticket stays in backlog/active/
    And no note is sent

  # BL-1479 a-ticket-that-cannot-advance-does-not-hold-a-slot-04
  Scenario: a parked ticket is an ordinary promotion candidate once its date has passed
    Given a ticket the sweep parked for a not_before that is now yesterday
    When the promotion gates evaluate it
    Then no gate refuses it
