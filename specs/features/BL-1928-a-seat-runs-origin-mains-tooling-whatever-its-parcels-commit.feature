Feature: BL-1928 A seat runs origin main's tooling whatever its parcel's commit

  Since BL-1871 a task-mode role takes up a parcel by moving its worktree
  onto the parcel's commit. Every worktree seat runs the swarm's tooling
  (ready_for_next, the served task text, swarm_handoff, done_with_current)
  from ./swarmforge/scripts in that worktree, so after a take-up it runs the
  tooling as it stood at the parcel's commit. A hotfix to that tooling on
  origin main does not reach a seat whose parcel was cut before it. On
  2026-10-03 the coder took up QA's bounce of BL-1858 at 9ae037c77a (cut
  10:47Z) and ran tooling that lacked six hotfixes landed since, among them
  the served forward steps (aec0daba54) and the bounce task-name lookup
  (b12d063001). The daemons and the master-resident roles run main's copy
  and are not affected.

  Background:
    Given a fixture project whose origin main holds a change to the served task text made after BL-9001's parcel commit

  # BL-1928 a-taken-up-parcel-is-served-by-origin-mains-tooling-01
  Scenario: a seat that takes up a parcel cut before a tooling change is served by origin main's tooling
    Given the architect's inbox holds a git_handoff for BL-9001 citing that parcel commit
    When the architect asks for its next task
    Then the served task text carries the line origin main's tooling adds
    And the architect's worktree HEAD has the parcel commit as an ancestor
    And no commit between origin/main and the architect's HEAD names a ticket other than BL-9001

  # BL-1928 a-parcel-already-on-origin-mains-tooling-is-served-the-same-02
  Scenario: a seat whose parcel already carries origin main's tooling is served exactly as today
    Given the architect's inbox holds a git_handoff for BL-9001 citing a commit on top of origin main
    When the architect asks for its next task
    Then the architect's worktree HEAD is that commit
    And the served task text carries the line origin main's tooling adds

  # BL-1928 a-master-resident-checkout-is-untouched-03
  Scenario: a master-resident role's shared checkout is neither moved nor merged
    Given the specifier and the coordinator share one checkout on main
    When the specifier asks for its next task
    Then the shared checkout's HEAD and branch have not changed

  # BL-1928 a-tooling-change-landed-mid-parcel-reaches-the-seat-04
  Scenario: a tooling change landed on origin main while a seat holds its parcel reaches the seat at its next ask
    Given the architect has taken up the git_handoff for BL-9001 citing that parcel commit
    And origin main then gains a second change to the served task text
    When the architect asks for its next task
    Then the served task text carries the line the second change adds
    And the architect's worktree HEAD has not moved
