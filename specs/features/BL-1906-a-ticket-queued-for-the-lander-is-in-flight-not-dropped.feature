Feature: A ticket queued for the lander is in flight, not dropped

  BL-719's dropped-parcel sweep and BL-1415's dispatch verdict count a
  parcel as in flight only when a handoff for the ticket sits in some
  role's new or in_process mailbox. Since BL-1872, QA's last act on an
  approved parcel is an entry in the lander queue, and QA completes the
  git_handoff it approved. While that entry waits its turn or is landing,
  no mailbox holds anything for the ticket, so a correct, approved parcel
  reads as dropped.

  On 2026-10-02 the sweep told the coordinator "BL-1879 no parcel in
  flight - possible drop" four times while 3bef687e1f waited in the queue,
  and the coordinator re-sent the parcel to QA. route_backlog_to_coder.sh
  acts on the same verdict and routes a DROPPED ticket to the coder
  without --force, which would rebuild approved work from the start.

  A land that has finished, landed or refused, is no longer in flight:
  the lander has handed the ticket on by note, and a drop after that is
  still a drop. A running land stuck past an hour is already reported to
  QA by the lander itself, so counting it as in flight hides nothing.

  Background:
    Given an active ticket with a trail, no parcel in any role's mailbox, and a trail stale past the threshold

  # BL-1906 lander-queued-ticket-is-in-flight-01
  Scenario Outline: a land still waiting or running keeps the ticket off the drop nudge
    Given the lander queue holds an entry for the ticket with status "<status>"
    When the daemon's dropped-parcel sweep evaluates it
    Then a dropped-parcel nudge is sent: "<sent>"

    Examples:
      | status  | sent |
      | queued  | no   |
      | running | no   |
      | landed  | yes  |
      | refused | yes  |

  # BL-1906 lander-queued-ticket-is-in-flight-02
  # Absence must never buy silence (BL-1301's posture): only an entry that
  # names this ticket and is still landing changes the verdict.
  Scenario Outline: a lander queue that says nothing about the ticket changes nothing
    Given the lander queue is "<queue>"
    When the daemon's dropped-parcel sweep evaluates it
    Then a dropped-parcel nudge is sent: "yes"

    Examples:
      | queue                     |
      | absent                    |
      | queued for another ticket |
      | an unreadable entry       |

  # BL-1906 lander-queued-ticket-is-in-flight-03
  Scenario Outline: the verdict the router acts on agrees with the sweep
    Given the lander queue holds an entry for the ticket with status "<status>"
    When dispatch_trail_cli.bb is asked whether the ticket was dispatched
    Then its answer begins "<verdict>"

    Examples:
      | status  | verdict    |
      | queued  | DISPATCHED |
      | running | DISPATCHED |
      | refused | DROPPED    |
