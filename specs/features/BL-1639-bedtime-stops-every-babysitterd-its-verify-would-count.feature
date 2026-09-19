Feature: BL-1639 Bedtime stops every babysitterd its own verify would count

  finish-shift (BL-762) stops babysitterd by signalling one pidfile,
  .swarmforge/babysitterd/babysitterd.pid, and then verifies (BL-637) by
  matching every process whose arguments contain babysitterd.sh, from any
  root. The two read different populations. On 2026-09-18 an operator-local
  copy of the daemon, launched from .swarmforge/operator/ with its own
  pidfile, was counted by the verify and never signalled by the stop:
  finish-shift refused with rc=1 and the copy swept a dead stack for two
  hours. After this parcel the stop, the verify and kill_all_swarm's
  babysitterd signal read one root-scoped census, and a babysitterd of
  another root is neither signalled nor counted.

  Background:
    Given a fixture root under a temporary directory with the finish-shift library loaded
    And process signals are recorded through an injected seam instead of being sent

  # BL-1639 both-babysitterds-of-this-root-are-signalled-01
  Scenario: two babysitterds of this root are both signalled and the verify census names exactly those pids
    Given the process snapshot lists a babysitterd launched as "<root>/swarmforge/scripts/babysitterd.sh <root>" whose pid is in the tracked pidfile
    And the snapshot lists a second babysitterd launched as "<root>/.swarmforge/operator/babysitterd.sh" with no tracked pidfile
    When finish-shift stops the babysitterd component
    Then both pids are signalled
    And the babysitterd verify census for this root names exactly the signalled pids
    And the tracked pidfile is removed

  # BL-1639 a-babysitterd-of-another-root-is-neither-signalled-nor-counted-02
  Scenario: a babysitterd of another root is neither signalled nor counted
    Given the process snapshot lists a babysitterd launched as "<root>/swarmforge/scripts/babysitterd.sh <root>" whose pid is in the tracked pidfile
    And the snapshot lists a babysitterd launched as "/tmp/other/swarmforge/scripts/babysitterd.sh /tmp/other"
    And the snapshot lists a babysitterd launched as "<root>/.worktrees/coder/swarmforge/scripts/babysitterd.sh <root>/.worktrees/coder"
    When finish-shift stops the babysitterd component
    Then only the pid of this root is signalled
    And the babysitterd verify census for this root names only that pid

  # BL-1639 the-nuclear-path-reads-the-same-census-03
  Scenario: kill_all_swarm signals the same babysitterd census
    Given the process snapshot lists a babysitterd launched as "<root>/swarmforge/scripts/babysitterd.sh <root>" whose pid is in the tracked pidfile
    And the snapshot lists a second babysitterd launched as "<root>/.swarmforge/operator/babysitterd.sh" with no tracked pidfile
    When kill_all_swarm runs against the fixture root
    Then both pids are signalled

  # BL-1639 a-stack-with-only-the-tracked-daemon-is-unchanged-04
  Scenario: a stack with only the tracked daemon behaves as today
    Given the process snapshot lists a babysitterd launched as "<root>/swarmforge/scripts/babysitterd.sh <root>" whose pid is in the tracked pidfile
    When finish-shift stops the babysitterd component
    Then exactly that pid is signalled
    And the tracked pidfile is removed
