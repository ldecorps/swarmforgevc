Feature: BL-1224 the operator-runtime watch adopts a deliberately restarted runtime instead of counting a crash

  On 2026-08-28 operator_runtime_supervisor.log announced "operator runtime
  restarted (pid N, attempt K)" six times between 00:49Z and 01:19Z, climbed to
  attempt 5, gave up, cooled down and re-armed at 01:34Z - then began the climb
  again. Nothing had crashed. Each of those deaths was deliberate: the
  coordinator runs `build_freshness_cli.bb <root> sync` after every QA merge,
  and its restart-operator-group! stops the live runtime and starts a fresh one
  itself. Every one of the ten crashes in that window is preceded within ~20s by
  a `start_handoff_daemon invoked ... caller=unknown` line in the same sync's
  audit log; runtime.log shows "operator-runtime started" twice at 01:46:13Z and
  01:46:45Z - the sync's start, then the supervisor's.

  The watch tracks the pid it last spawned. check-one! asks only "is that pid
  alive?" (front_desk_supervisor_lib.bb:272), so a pid that was replaced looks
  exactly like a pid that died. The discriminator it never consults is the
  pidfile: after a deliberate restart it names a DIFFERENT, live
  operator_runtime.bb; after a real crash it names the dead pid, or nothing.

  Background:
    Given an operator-runtime watch tracking a live operator runtime at pid 1001

  # BL-1224 watch-adopts-a-deliberately-restarted-operator-runtime-01
  Scenario Outline: the pidfile decides whether a vanished tracked pid was a crash or a handover
    Given the tracked pid 1001 is no longer alive
    And the runtime pidfile <pidfile_state>
    When the watch runs one check
    Then the event is "<event>"

    Examples:
      | pidfile_state                                     | event   |
      | names live pid 2002 running operator_runtime.bb   | adopted |
      | names the same dead pid 1001                      | crashed |
      | is absent                                         | crashed |
      | names live pid 2002 running an unrelated command  | crashed |

  # BL-1224 watch-adopts-a-deliberately-restarted-operator-runtime-02
  Scenario: an adoption neither starts a process nor spends the restart budget
    Given the watch has recorded 3 restart attempts
    And the tracked pid 1001 is no longer alive
    And the runtime pidfile names live pid 2002 running operator_runtime.bb
    When the watch runs one check
    Then no start command is run
    And the recorded restart attempts are still 3
    And the watch now tracks pid 2002

  # BL-1224 watch-adopts-a-deliberately-restarted-operator-runtime-03
  Scenario: an adoption is recorded but never announced to the human
    Given the tracked pid 1001 is no longer alive
    And the runtime pidfile names live pid 2002 running operator_runtime.bb
    When the watch runs one check
    Then no human announcement is sent
    And the supervisor log records an adoption naming pid 2002
    And the supervisor status file reports status "running" with pid 2002

  # BL-1224 watch-adopts-a-deliberately-restarted-operator-runtime-04
  Scenario: a genuinely crashed runtime is still restarted and still announced
    Given the tracked pid 1001 is no longer alive
    And the runtime pidfile names the same dead pid 1001
    When the watch runs checks until the restart backoff has elapsed
    Then the start command is run once
    And a human announcement says the operator runtime was restarted
