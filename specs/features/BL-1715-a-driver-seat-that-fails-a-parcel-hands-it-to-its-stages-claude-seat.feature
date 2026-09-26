Feature: BL-1715 A driver seat that fails a parcel hands it to its stage's Claude seat

  In the mixed pack the coder stage has two seats: a Claude seat and a
  local seat run by the parcel driver. When the local seat's gate still
  fails after its last fix turn, the parcel does not wait on the human:
  the attempt is recorded, the local seat gives the parcel up, and the
  Claude seat works it next. The local seat never takes that ticket again,
  its failed changes do not stay in its tree, and every attempt it makes,
  passed or given up, leaves one outcome row. A stage whose only seats are
  driver seats keeps the escalate-and-hold path unchanged.

  Background:
    Given a fixture coder stage with a Claude seat "coder" and a driver seat "coder@2"
    And coder@2 has claimed a low-cost coder parcel whose gate still fails after its last fix turn

  # BL-1715 the-given-up-parcel-goes-to-the-claude-seat-01
  Scenario: the given-up parcel is worked next by the Claude seat with no deferral
    When the driver finishes coder@2's last fix turn
    Then coder@2 holds no in-process parcel
    And the Claude seat's next poll claims a parcel with the same task and received commit

  # BL-1715 the-seat-that-gave-up-never-takes-the-ticket-again-02
  Scenario Outline: coder@2 never claims that ticket again
    Given coder@2 has given the parcel up
    And <parcel> for that ticket is in the coder stage queue
    When both seats poll
    Then the Claude seat claims it and coder@2 does not

    Examples:
      | parcel                       |
      | the handed-over parcel       |
      | a later rework bounce        |

  # BL-1715 the-failed-attempt-leaves-the-local-tree-03: retired by BL-1778.
  # A give-up's tree contract now lives there (the post-merge tree, not
  # the pre-claim tree this scenario pinned) - retired, never reworded
  # (BL-1778's own direction).

  # BL-1715 a-driver-only-stage-keeps-the-hold-04
  Scenario: a stage with no Claude seat keeps the escalate-and-hold path
    Given the Claude seat is removed from the fixture coder stage
    When the driver finishes coder@2's last fix turn
    Then the parcel stays in process on coder@2 marked escalated
    And one outcome row records the ticket as "escalated"
