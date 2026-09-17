Feature: BL-1610 The merge-drop gate judges only the merges the sender made and only what the forward carries

  BL-1576's send gate bounds its scan to merges reachable from the forwarded
  commit and not from the received one. When the received parcel is the
  coordinator's route git_handoff, whose commit is main's tip at promotion,
  that range is the sender's entire off-main history: 66 merges on the
  coder branch on 2026-09-16, six of them cross-role merges from hours
  earlier whose one-sided resolutions later merges had already superseded,
  so the coder's BL-1606 send was refused with nine findings on three
  paths that the forward did not change at all (every implicated path's
  blob at the forwarded commit equals its blob at the received commit).
  The same sender's BL-1602 send an hour earlier, received from the
  architect, scanned an empty range. This feature is that the scan is
  bounded to merges the sender made after it received the parcel, that a
  finding on a path the forward leaves identical to the received commit is
  excused because no dropped line can ride that forward, and that a merge
  the sender made since receipt that drops uncontested hunks the forward
  carries is still refused exactly as BL-1576 refuses it.

  Background:
    Given a fixture repository with a main branch, a coder branch that merged main and a sibling branch several times before the parcel, and a coder role whose mailbox holds the received parcel

  # BL-1610 merge-drop-gate-judges-only-what-the-forward-carries-01
  Scenario Outline: only a merge the sender made since receipt, on a path the forward changes, refuses the send
    Given the received parcel's commit is <received>
    And the coder branch carries a one-sided merge from before the parcel that dropped uncontested hunks on a path
    And after receipt the coder made <since>
    And the forwarded commit <forward>
    When the coder sends a git_handoff for the parcel
    Then the send is <outcome>

    Examples:
      | received                                   | since                                                          | forward                                            | outcome                                                    |
      | main's tip, the coordinator's route commit | a plain commit on another path                                 | changes nothing on the dropped path                | queued with no merge-drop finding                          |
      | main's tip, the coordinator's route commit | a merge that dropped the sibling's uncontested hunks on a path | changes that path against the received commit      | refused naming that merge, that path and the dropped lines |
      | main's tip, the coordinator's route commit | a merge that dropped the sibling's uncontested hunks on a path | leaves that path identical to the received commit  | queued, the finding excused as carrying nothing            |
      | the sibling branch's tip                   | a plain commit on another path                                 | changes nothing on the dropped path                | queued with no merge-drop finding                          |
      | the sibling branch's tip, after the sibling itself made a one-sided merge that dropped uncontested hunks on a second path | a plain commit on that second path | changes that second path against the received commit | queued with no merge-drop finding |

  # BL-1610 merge-drop-gate-judges-only-what-the-forward-carries-02
  Scenario: the refusal that opened this ticket is a queue on the fixed gate
    When the gate is asked about a received commit on main and a forwarded commit with no merge of the sender's since receipt and every implicated path unchanged against the received commit
    Then it reports no finding
