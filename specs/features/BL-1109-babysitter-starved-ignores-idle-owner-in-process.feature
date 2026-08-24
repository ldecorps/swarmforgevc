Feature: BL-1109 babysitter STARVED counts a live in_process claim as motion even when the owner pane is idle
  babysitterd's swarm-starved check (check 10) only treats an in_process
  claim as motion when the owning pane is classified busy. A Cursor
  Thinking pause, a rotate gap, or a follow-up bar makes the owner look
  idle for two sweeps while parcels still sit in in_process — the CRIT
  then fires and claims "zero pending/in-process parcels" even though
  claims exist.

  Measured 2026-08-23 on cursor-mono-router: resident QA held BL-1099 in
  worktree in_process and documenter held BL-1087; both panes sampled
  idle; STARVED CRIT fired. Distinct from BL-807 (stuck-in-process WARN
  ownership); this is the starved predicate and its CRIT copy.

  Background:
    Given a swarm with at least one active ticket and no control pause

  # BL-1109 starved-in-process-motion-01
  Scenario Outline: starved motion depends on whether a live in_process claim exists
    Given the mailbox state is "<mailbox>"
    And every pane is idle
    When babysitterd evaluates the swarm-starved check for two consecutive idle sweeps
    Then the swarm-starved verdict is "<verdict>"

    Examples:
      | mailbox                                      | verdict   |
      | one non-abandoned in_process claim, owner idle | clear   |
      | no pending and no in_process claims            | starved |

  # BL-1109 starved-crit-copy-04
  Scenario: when in_process claims exist the CRIT never claims the mailbox is empty
    Given an in_process handoff whose owning role's pane is idle this sweep
    When the starved finding text is composed for that sweep
    Then the text does not claim zero pending or in-process parcels

  # BL-1109 starved-in-process-glob-03
  Scenario Outline: in_process discovery sees the same mailbox shapes stuck-in-process already sees
    Given an in_process handoff at "<path-shape>"
    When babysitterd gathers in-process claims for the starved check
    Then that handoff is among the claims

    Examples:
      | path-shape                                      |
      | a role worktree inbox/in_process/*.handoff      |
      | a nested worktree **/inbox/in_process/*.handoff |
      | a batch_* in_process directory handoff          |
