Feature: A batch role's held parcel is visible to the send-time guards

  Two send-time guards read a role's in_process to decide whether a
  git_handoff may be sent: the merge-only self-check (Article 2.4 - a role
  holding a non-forwarding inbound may not forward it) and BL-760's
  duplicate-chain guard (the same ticket must not run as two live chains).

  Both walk in_process as a flat list of .handoff files. A batch role
  (cleaner, hardender) does not hold parcels that way - ready_for_next
  claims them into an in_process/batch_*/ directory one level deeper - so
  for those two roles both guards read the mailbox as empty. The merge-only
  refusal is therefore inert exactly where it is needed, and the
  duplicate-chain guard fails open on any parcel a batch role holds.

  A role's receive mode is a scheduling property. It must not decide what a
  guard can see.

  Observed 2026-08-31: the cleaner, holding architect's non-forwarding
  reverse copy of BL-1303 inside a batch directory, was never told the
  inbound was merge-only. It implemented the coder's bounced fix, and only
  at send time was refused - by the duplicate-chain guard, naming a parcel
  in the coder's mailbox. That message describes someone else's mailbox, so
  it read as a transport fault rather than "you may not forward this"; the
  cleaner diagnosed a lost reverse-hop stamp, escalated by note, and lost
  the cycle.

  Background:
    Given a role is sending a forward git_handoff for a ticket

  # BL-1313 batch-held-parcel-visible-to-send-time-guards-01
  # The incident scenario. The refusal must name the sender's own inbound,
  # not another role's mailbox - a message about a mailbox the sender does
  # not own is what sent the cleaner looking for a transport fault.
  Scenario Outline: the sender's own non-forwarding inbound refuses the send wherever it is held
    Given the sender holds a non-forwarding inbound for that ticket <held>
    When the send-time guards evaluate the send
    Then the send is refused with the merge-only reason, not the duplicate-chain reason

    Examples:
      | held                                       |
      | as a flat file in its in_process           |
      | inside a batch directory in its in_process |

  # BL-1313 batch-held-parcel-visible-to-send-time-guards-02
  # Fail-closed restored: BL-760's guard must catch a competing chain held
  # by a batch role, which today it cannot see at all.
  Scenario Outline: a live forward parcel held by another role blocks wherever it is held
    Given another role holds a live forward parcel for that ticket <held>
    When the send-time guards evaluate the send
    Then the send is blocked naming that parcel

    Examples:
      | held                                       |
      | as a flat file in its in_process           |
      | inside a batch directory in its in_process |

  # BL-1313 batch-held-parcel-visible-to-send-time-guards-03
  # BL-1302's exemption must survive the fix: teaching the guard to descend
  # into batch directories must not start blocking on reverse-hop copies it
  # was taught to skip.
  Scenario Outline: a non-forwarding copy held by another role blocks nothing wherever it is held
    Given another role holds a live parcel for that ticket marked non-forwarding <held>
    When the send-time guards evaluate the send
    Then the send is not blocked

    Examples:
      | held                                       |
      | as a flat file in its in_process           |
      | inside a batch directory in its in_process |

  # BL-1313 batch-held-parcel-visible-to-send-time-guards-04
  # No false refusal: an empty batch directory left behind by a drained
  # parcel must not read as a held parcel.
  Scenario: an emptied batch directory does not refuse the send
    Given the sender holds no inbound for that ticket
    And an empty batch directory remains in its in_process
    When the send-time guards evaluate the send
    Then the send is not blocked

  # BL-1313 batch-held-parcel-visible-to-send-time-guards-05
  # BL-1302: the self-check folds via `some` over the sender's own
  # in_process. A single-parcel fixture cannot tell `some` from `every?` -
  # the sender must hold a SECOND, ordinary parcel that disagrees with the
  # non-forwarding one, held at the OTHER depth, so only `some` still
  # refuses (an `every?` regression would silently allow the send).
  Scenario Outline: the sender's own non-forwarding inbound still refuses the send alongside a disagreeing ordinary parcel
    Given the sender holds a non-forwarding inbound for that ticket <nonforwarding_held>
    And the sender also holds an ordinary inbound for a different ticket <ordinary_held>
    When the send-time guards evaluate the send
    Then the send is refused with the merge-only reason, not the duplicate-chain reason

    Examples:
      | nonforwarding_held                          | ordinary_held                               |
      | as a flat file in its in_process             | inside a batch directory in its in_process  |
      | inside a batch directory in its in_process   | as a flat file in its in_process            |
