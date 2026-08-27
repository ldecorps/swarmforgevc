Feature: the expeditor's forbidden-stop-flag guard reads the configured command as a command line

  The expeditor stops the stack as part of initiation, running whatever
  EXPEDITE_STOP_CMD names. Three stop-swarm flags are forbidden there:
  --sweep-inbox archives exactly the pending handoffs a parked ticket needs in
  order to resume, --reset-worktrees reverts role worktrees, and --full is
  both. The guard that refuses them must decide on the command line the
  expeditor would actually run, so that every real invocation carrying a
  forbidden flag is refused before anything is parked or stopped. Deciding on
  the whole command line also means deciding by token: a target path that
  merely contains a forbidden flag's spelling as a substring is not a
  forbidden flag, and a command line the guard cannot read is refused rather
  than admitted.

  Background:
    Given a repo with no live swarm, a fixture ticket in backlog/active/ and a second active ticket the run would park

  # BL-1030 forbidden-stop-flag-guard-01
  Scenario Outline: a configured stop command carrying a forbidden flag is refused
    Given the configured stop command is <command>
    When the expeditor initiates the fixture ticket
    Then the expeditor refuses naming <flag> and the stop command never runs

    Examples:
      | command                                      | flag              |
      | ./stop-swarm.sh --sweep-inbox                | --sweep-inbox     |
      | ./stop-swarm.sh --reset-worktrees            | --reset-worktrees |
      | ./stop-swarm.sh --full /repos/fixture-target | --full            |
      | ./stop-swarm.sh && ./stop-swarm.sh --full    | --full            |

  # BL-1030 forbidden-stop-flag-guard-02
  Scenario Outline: a safe stop command still runs
    Given the configured stop command is <command>
    When the expeditor initiates the fixture ticket
    Then the stop command runs and initiation continues

    Examples:
      | command                                     |
      | ./stop-swarm.sh                             |
      | ./stop-swarm.sh /repos/fixture-target       |
      | ./stop-swarm.sh /repos/full-sweep-inbox-fix |

  # BL-1030 forbidden-stop-flag-guard-03
  Scenario: a stop command the guard cannot tokenize is refused rather than admitted
    Given the configured stop command is ./stop-swarm.sh '--sweep-inbox
    When the expeditor initiates the fixture ticket
    Then the expeditor refuses naming the command it could not read and the stop command never runs

  # BL-1030 forbidden-stop-flag-guard-04
  Scenario: a refusal costs nothing because it is decided before anything is parked
    Given the configured stop command is ./stop-swarm.sh --sweep-inbox
    When the expeditor initiates the fixture ticket
    Then the second active ticket is still in backlog/active/ and backlog/hold/ is empty
