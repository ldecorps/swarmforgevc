# A git_handoff names one ticket in `task:` and one commit in `commit:`. Nothing
# checks that they agree. On 2026-08-19 the coder sent commit 896e1d5cb2 - whose
# subject is "BL-949: concierge board-wiring tests..." - to the cleaner under
# `task: BL-935-cap-the-vitest-fork-pool...`, 39 seconds after correctly sending
# that same commit under `task: BL-949-...`. The cleaner merged it and forwarded
# it on, faithfully preserving the received task name as PIPELINE.md step 3
# requires. A parcel bearing BL-935's name, carrying zero BL-935 content, reached
# the architect - who caught it by eye. Nothing mechanical looked.
#
# BL-760's duplicate-chain guard could not catch this: it keys on the ticket id
# in the `task:` header, so one commit sent under two DIFFERENT task names reads
# as two unrelated tickets and both pass. That guard covers one ticket / two
# chains; this one covers the complementary axis - a task naming a ticket its
# commit does not contain.
#
# The gate FAILS OPEN by design. Legitimate sends cite commits whose subject
# names no ticket at all ("Merge commit 'e336c44dba' into swarm/coder", sent the
# same morning under both BL-631 and BL-945 - a lawful Article 2.6 multi-ticket
# batch forward). Only a POSITIVE, confident contradiction blocks: the commit
# resolves to some ticket id, and the task's ticket is not among them. Silence
# is never treated as a mismatch - same posture as the BL-880 pointer gate.

Feature: A git_handoff's commit must belong to the ticket its task names

  Background:
    Given a swarm repository whose roles send parcels with swarm_handoff.sh

  # BL-953 handoff-task-commit-coherence-01
  Scenario Outline: a git_handoff is refused only when its commit positively contradicts its task
    Given a commit whose introduced history names <commit_tickets>
    When the coder sends a git_handoff for task ticket "<task_ticket>" citing that commit
    Then the send is <outcome>

    Examples:
      | commit_tickets | task_ticket | outcome  |
      | BL-949         | BL-935      | refused  |
      | BL-949         | BL-949      | accepted |
      | no ticket id   | BL-935      | accepted |
      | BL-631, BL-945 | BL-945      | accepted |

  # BL-953 handoff-task-commit-coherence-02
  Scenario: the refusal names both tickets so the sender can tell which header is wrong
    Given a commit whose introduced history names "BL-949"
    When the coder sends a git_handoff for task ticket "BL-935" citing that commit
    Then the refusal reports the ticket the task names and the ticket the commit carries
    And the parcel is not delivered to any mailbox

  # BL-953 handoff-task-commit-coherence-03
  Scenario: a mislabel is refused at every hop, not only where it was minted
    Given a commit whose introduced history names "BL-949"
    When the cleaner sends a git_handoff for task ticket "BL-935" citing that commit
    Then the send is refused

  # BL-953 handoff-task-commit-coherence-04
  Scenario: an unreadable commit subject warns and never blocks the send
    Given a commit whose introduced history cannot be read
    When the coder sends a git_handoff for task ticket "BL-935" citing that commit
    Then the send is accepted
    And a warning records that the coherence check could not run

  # BL-953 handoff-task-commit-coherence-05
  Scenario: a parcel type that carries no commit is unaffected
    When the coder sends a note to the coordinator
    Then the send is accepted
