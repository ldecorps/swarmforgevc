Feature: The handoffd supervisor reaps only its own project root's daemon

# BL-321: handoffd_supervisor.bb's reaper matches the project root as a bare
# substring of a process command line, so it kills daemons belonging to nested
# roots and to sibling projects whose path merely extends this root as a prefix.
# A daemon belongs to this root only when its root argument IS this root —
# matched on a path boundary, never as a substring.

Background:
  Given a supervisor supervising the project root "/srv/swarm"

# BL-321 supervisor-reaper-path-boundary-01
Scenario Outline: Only a daemon whose root IS the project root is reaped
  Given an untracked handoffd.bb daemon started with the root "<daemon_root>"
  When the supervisor runs its orphan reap check
  Then the daemon <outcome>

  Examples:
    | daemon_root       | outcome       |
    | /srv/swarm        | is reaped     |
    | /srv/swarm/tmp/fx | is left alive |
    | /srv/swarm/target | is left alive |
    | /srv/swarm-2      | is left alive |
    | /srv/swarmforge   | is left alive |
    | /srv/other        | is left alive |

# BL-321 supervisor-reaper-path-boundary-02
Scenario: Reaping a genuine orphan records it in the supervisor log
  Given an untracked handoffd.bb daemon started with the root "/srv/swarm"
  When the supervisor runs its orphan reap check
  Then a reap-orphan entry is written for that daemon

# BL-321 supervisor-reaper-path-boundary-03
Scenario: A spared daemon is left able to keep delivering handoffs
  Given an untracked handoffd.bb daemon started with the root "/srv/swarm-2"
  When the supervisor runs its orphan reap check
  Then no reap-orphan entry is written for that daemon
  And that daemon remains able to deliver handoffs

# BL-321 supervisor-reaper-path-boundary-04
Scenario: The supervisor never reaps itself
  Given the running handoffd_supervisor.bb process names the root "/srv/swarm"
  When the supervisor runs its orphan reap check
  Then the supervisor process is left alive
