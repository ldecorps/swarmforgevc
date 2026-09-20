Feature: BL-1655 A claim reclaimed at relaunch stays with the seat that held it until the cross-seat deadline

  At relaunch the BL-648 orphan-claim sweep moves every dead session's claim
  back to its role's new/ so nothing stays silently claimed. On a stage with
  two seats that directory is the queue both seats read (BL-983, BL-1615),
  and the moved file carries nothing that says which seat held it, so the
  sibling seat claims it first while the seat that held it finishes the
  same work from its own worktree. On 2026-09-20 coder@2 claimed BL-1652's
  Work note 26 seconds after the sweep took it from the coder seat, and the
  ticket was built twice. After this parcel the reclaimed file carries the
  seat that held it; that seat claims it at once, a sibling leaves it alone
  until the cross-seat claim deadline (BL-1004's window and polarity) and
  then claims it out loud, the stall sweeps do not count the wait as a
  stuck parcel, and a stage with one seat behaves exactly as today.

  Background:
    Given a fixture project root under a temporary directory with a roles.tsv carrying a two-seat coder stage, a documenter seat and a master-resident specifier seat
    And a cross-seat claim deadline of 30 minutes
    And no live tmux session for any seat

  # BL-1655 the-reclaim-names-the-seat-that-held-it-01
  Scenario: the sweep re-delivers a dead seat's claim carrying the seat that held it
    Given the coder seat holds a claimed note in its in_process
    When the orphan-claim sweep runs
    Then the note sits in the coder stage queue under its original basename
    And the reclaimed file records the coder seat as the seat that held it
    And the reclaim line names the coder seat

  # BL-1655 the-sibling-leaves-a-fresh-reclaim-alone-02
  Scenario Outline: a sibling seat leaves a reclaimed item to the seat that held it inside the deadline
    Given the coder stage queue holds a <type> reclaimed from the coder seat <age> minutes ago
    When the coder@2 seat asks for its next task
    Then it claims nothing
    And it prints a deferral line that names no seat
    And the item is still in the coder stage queue

    Examples:
      | type        | age |
      | note        | 1   |
      | git_handoff | 29  |

  # BL-1655 the-holder-claims-its-own-reclaim-at-once-03
  Scenario: the seat that held a reclaimed item claims it on its first poll
    Given the coder stage queue holds a note reclaimed from the coder seat 2 minutes ago
    When the coder seat asks for its next task
    Then it claims the item into its own in_process

  # BL-1655 the-deadline-releases-the-item-to-the-sibling-04
  Scenario: past the deadline the sibling claims the reclaimed item out loud
    Given the coder stage queue holds a note reclaimed from the coder seat 31 minutes ago
    When the coder@2 seat asks for its next task
    Then it claims the item into its own in_process
    And it prints a cross-seat claim line

  # BL-1655 a-single-seat-stage-is-unchanged-05
  Scenario Outline: a seat with no sibling re-claims its own reclaimed item exactly as today
    Given the <seat> seat holds a claimed note in its in_process
    When the orphan-claim sweep runs
    And the <seat> seat asks for its next task
    Then it claims the item into its own in_process
    And it prints no deferral line

    Examples:
      | seat       |
      | documenter |
      | specifier  |

  # BL-1655 a-deferred-reclaim-is-not-a-stuck-parcel-06
  Scenario: the stall sweeps do not count a deferred reclaimed item as stuck inside the deadline
    Given the coder stage queue holds a note reclaimed from the coder seat 20 minutes ago
    When the flow watchdog scans the coder stage queue
    Then it raises no stuck-parcel finding for the item
