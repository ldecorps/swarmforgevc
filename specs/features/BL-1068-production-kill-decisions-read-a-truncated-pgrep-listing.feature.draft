Feature: BL-1068 a production decision about a process reads its argument list, not its name
  BL-1061 found that `pgrep -fl` means two different things on the two
  userlands SwarmForge targets. `-f` decides what pgrep MATCHES (the full
  command line) and is correct everywhere. `-l` decides what it PRINTS:
  BSD/macOS prints the full argument list, procps-ng prints the process NAME
  alone. Measured on this host (procps-ng 4.0.4), a candidate that really is
  `node /repo/extension/out/tools/start-bridge-headless.js /repo 8765` is
  handed to the reader as `4242 node`.

  BL-1061 repaired the one site it owned, in tunnel_ownership_lib.sh. Three
  more production sites read that same listing as TEXT and are left wrong:

    start_bridge_headless.sh   frees the port by signalling every candidate
                               whose line does not carry this root. The line
                               never carries anything, so the guard is always
                               true and the block signals bridges it was
                               written to spare.
    kill_pipeline_swarm.sh     reaps stray handoffd processes and filters the
                               supervisor out by name. The line never carries
                               the name, so the filter can never exclude
                               anything - a defence that is inert today and
                               silently absent the moment the pattern that
                               feeds it widens to reach the supervisor.
    collect_daemon_postmortem  records the process table AFTER a daemon death.
                               Its section reads `602143 bb` / `602162 bb`,
                               which cannot tell the daemon from its own
                               supervisor, nor one root's from another's - the
                               single discrimination the artefact exists for.

  The port-freeing guard carries a second, independent defect on the same
  line. It decides "belongs to another root" by asking whether the command
  line CONTAINS this root as a substring. Worktrees are nested under their
  master root, so a worktree's bridge always contains the master root and
  reads as ours - the exact case the block was written for is the one it can
  never handle, and from a worktree the test inverts and the master's bridge
  reads as foreign.

  The two are coupled and cannot be split. While the listing is truncated the
  containment test never runs, so repairing the listing alone would turn a
  block that over-signals into one that signals nothing at all.

  Background:
    Given the swarm root is "/repo"

  # BL-1068 port-freeing-decision-01
  Scenario Outline: the port-freeing decision reads ownership from the argument list
    Given a candidate holding the port is "<candidate>"
    When the port-freeing decision runs
    Then the candidate is "<disposition>"

    Examples:
      | candidate                        | disposition |
      | this root's own bridge           | spared      |
      | another root's bridge            | signalled   |
      | a worktree bridge under this root | signalled  |

  # BL-1068 stray-daemon-reap-02
  Scenario Outline: the stray-daemon reap never signals the supervisor
    Given a daemon and its own supervisor are both running for that root
    And the candidate listing carries "<listing>"
    When the stray-daemon reap decision runs
    Then the daemon is signalled
    And the supervisor is not signalled

    Examples:
      | listing               |
      | the full argument list |
      | the process name only  |

  # BL-1068 postmortem-listing-03
  Scenario: the daemon postmortem records a process table that tells the two apart
    Given a daemon and its own supervisor are both running for that root
    When the daemon postmortem is collected
    Then its process-table section tells the daemon from its supervisor
    And it tells this root's processes from another root's

  # BL-1068 enumeration-listing-04
  Scenario: the enumeration hands the decision the full argument list
    Given a process this run created, bearing an argument this run chose
    When the enumeration lists candidates matching that argument
    Then the listed line carries that argument
