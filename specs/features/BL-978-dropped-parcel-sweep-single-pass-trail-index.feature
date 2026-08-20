Feature: BL-978 the dropped-parcel sweep reads each handoff file once, not once per active ticket

  chase_sweep_lib/dropped-parcel-items calls newest-trail-event-ms once per
  active backlog item, and each of those calls re-lists AND re-slurps every
  handoff file in all 40 scan dirs (8 roles x new/in_process/completed/sent/
  outbox). Measured on this host 2026-08-20: ~5900 files across the completed/
  sent dirs and 8 active tickets, so one sweep performs on the order of 47000
  file reads. The dropped-parcel-sweep boundary lines that morning read 30-143
  seconds (worst 143269 ms), with ZERO dropped-parcel-nudge lines emitted - the
  entire cost is the scan, not the nudging. That heavy sweep is what let
  BL-977's supervisor window elapse and halt the swarm.

  Background:
    Given a backlog tree with active tickets and a mailbox tree of handoff files

  # BL-978 dropped-parcel-sweep-single-pass-trail-index-01
  Scenario Outline: file reads scale with the mailbox, not with the active-ticket count
    Given <files> handoff files across the scan dirs
    And <items> active tickets
    When the dropped-parcel sweep evaluates one tick
    Then no handoff file is read more than once

    Examples:
      | files | items |
      | 40    | 1     |
      | 40    | 8     |
      | 400   | 8     |

  # BL-978 dropped-parcel-sweep-single-pass-trail-index-02
  Scenario: the candidate set is byte-identical to the pre-change sweep
    Given a fixture tree covering a ticket with a stale trail, a ticket with live mail, a ticket with no trail at all, and a ticket whose only trail file has no parseable timestamp header
    When the dropped-parcel sweep evaluates one tick
    Then the nudged ticket ids are exactly those the per-item scan produced for the same tree

  # BL-978 dropped-parcel-sweep-single-pass-trail-index-03
  Scenario: a sweep's own prior nudges are still excluded from freshness
    Given an active ticket whose only recent trail file is this sweep's own earlier coordinator nudge
    When the dropped-parcel sweep evaluates one tick
    Then that ticket is still reported as a dropped-parcel candidate

  # BL-978 dropped-parcel-sweep-single-pass-trail-index-04
  Scenario: an unparseable trail file never masks an otherwise stale trail
    Given an active ticket whose trail holds one stale file with a parseable timestamp and further files with no parseable timestamp header
    When the dropped-parcel sweep evaluates one tick
    Then that ticket is still reported as a dropped-parcel candidate

  # BL-978 dropped-parcel-sweep-single-pass-trail-index-06
  Scenario: a ticket whose whole trail is unparseable is never nudged on missing data
    Given an active ticket whose trail files all lack a parseable timestamp header
    When the dropped-parcel sweep evaluates one tick
    Then that ticket is not reported as a dropped-parcel candidate

  # BL-978 dropped-parcel-sweep-single-pass-trail-index-05
  Scenario: the indexed sweep stays inside the supervisor's stall window on the live tree
    Given the live mailbox tree of this host
    When the dropped-parcel sweep evaluates one tick
    Then its measured duration is below the supervisor stall threshold
