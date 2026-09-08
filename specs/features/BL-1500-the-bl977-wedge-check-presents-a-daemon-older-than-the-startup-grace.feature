Feature: BL-1500 The BL-977 wedge check presents a daemon older than the startup grace

  BL-977's fifth scenario proves that a poll loop which stops advancing while
  its process stays alive is still halted within the in-sweep budget. Its
  fixture ages the heartbeat and the sweep marker far into the past but writes
  the daemon's pid file fresh, and since the 2026-09-02 startup grace a pid
  file younger than one stall window means a newborn daemon that cannot be
  stalled: the check reads healthy before the wedge branch is reached, and
  BL-977's second invariant has been unverified by its own acceptance suite
  ever since. This feature is that the fixture presents a daemon at least as
  old as the silence it stages, while the grace itself keeps its contract, so
  the BL-977 feature resolves every scenario from the checkout it runs in.

  # BL-1500 a-wedged-loop-is-judged-by-its-pid-files-age-01
  Scenario Outline: a wedged poll loop is judged by its pid file's age against one stall window
    Given a supervisor fixture whose heartbeat and in-flight sweep marker are both past the in-sweep budget and whose pid names a live process
    And the pid file is <pid_file_age> than one stall window
    When the supervisor checks twice
    Then the status reads <state>
    And the swarm halt count across both checks is <halts>

    Examples:
      | pid_file_age | state   | halts |
      | older        | halted  | 1     |
      | younger      | healthy | 0     |

  # BL-1500 the-bl977-feature-resolves-every-scenario-02
  Scenario: the BL-977 feature resolves every scenario from the checkout it runs in
    Given the BL-977 feature file as tracked in the checkout the acceptance run is in
    When the BL-977 feature runs through the acceptance runner
    Then it reports ten scenarios passed and none failed
