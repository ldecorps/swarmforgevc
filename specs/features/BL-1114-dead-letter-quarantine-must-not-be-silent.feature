Feature: BL-1114 a dead-lettered handoff cannot sit invisible after quarantine or exhausted recovery
  A parcel renamed to *.handoff.dead (chase max-chases or corrupt quarantine)
  must surface to a human and must not leave the owning role with no
  actionable signal. Measured 2026-08-23: coder worktree
  inbox/new/ held
  00_20260822T222158Z_from_operator_to_coder_for_coder.handoff.dead
  with a sibling .recovery.json at attempts=3; the coder reported the
  quarantine as silent and unticketed. Operator notify state later showed
  the path as announced — so the gap is not "Telegram never fired" alone;
  it is that exhausted recovery / role-visible disposition still left the
  .dead sitting with no clear next step for the holder.

  Background:
    Given a role worktree mailbox under .worktrees/<role>/.swarmforge/handoffs

  # BL-1114 dead-letter-visible-01
  Scenario Outline: a newly dead-lettered handoff is announced or the refusal is named
    Given a *.handoff.dead appears in a role's inbox/new
    And the Operator topic <topic-state>
    When the dead-letter notify sweep runs
    Then the sweep outcome is "<outcome>"

    Examples:
      | topic-state     | outcome                                      |
      | exists          | announced naming that file                   |
      | is not yet created | records operator-topic-not-yet-created    |

  # BL-1114 dead-letter-recovery-02
  Scenario: exhausted recovery does not leave a silent .dead with no escalation
    Given a *.handoff.dead whose recovery attempts have reached the configured max
    When the recovery path evaluates that letter
    Then a needs-human or equivalent escalation is raised
    And the owning role is woken or otherwise told the parcel is terminal

  # BL-1114 corrupt-quarantine-03
  Scenario: corrupt quarantine uses the same visible dead-letter surface
    Given a handoff that fails corrupt-handoff? at dequeue
    When it is renamed to *.handoff.dead
    Then it is covered by the same announce-and-escalate path as a chase dead-letter
