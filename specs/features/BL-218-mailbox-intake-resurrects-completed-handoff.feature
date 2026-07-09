Feature: mailbox intake never resurrects an already-completed handoff

  Background:
    Given a role mailbox with new/, in_process/, completed/, and abandoned/

  # BL-218 intake-01
  Scenario Outline: a new-dir copy of an already-terminal handoff is not resurrected
    Given a handoff whose id already exists in <state>/
    And a stale copy of it sits in new/
    When the role runs its intake
    Then the stale copy is not promoted to in_process/
    And it is skipped with a logged "already-processed" line

    Examples:
      | state     |
      | completed |
      | abandoned |

  # BL-218 intake-02
  Scenario: a genuinely new handoff still dequeues normally
    Given a handoff in new/ whose id is in neither completed/ nor abandoned/
    When the role runs its intake
    Then it is promoted to in_process/ with a fresh dequeued_at

  # BL-218 intake-03
  Scenario: the layout fallback does not resurrect a completed handoff
    Given the base-dir fallback resolves the pre-BL-128 flat layout
    And that layout holds a completed handoff with a stale new/ copy
    When the role runs its intake
    Then the completed handoff is not re-promoted to in_process/

# Non-behavioral gates:
#  - The dedup check is a pure function over provided directory listings
#    (fixtures); no real mailbox I/O, no network, no real timers.
#  - Dedup is by handoff id/basename against completed/ AND abandoned/.
#  - Encodes the engineering.prompt Guardrail "Mailbox intake is idempotent"
#    (added 2026-07-09).
