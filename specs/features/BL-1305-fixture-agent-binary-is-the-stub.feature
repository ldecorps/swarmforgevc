Feature: An acceptance fixture never launches a real agent binary

  specs/pipeline/steps/roleLifecycleParkUnneededSteps.js shims the agent
  command by writing an `exit 0` stub into a temporary directory and
  prepending that directory to PATH via fakeEnv(). The stub is never
  reached. tmux starts each fixture pane with the user shell, that shell
  sources its own startup file, and the startup file prepends the directory
  holding the real agent binary ahead of the fixture directory. The bare
  name `claude` written into the fixture config therefore resolves to the
  real binary, and a real agent boots against the throwaway fixture root.

  Measured 2026-08-30: 21 real agent processes from 7 fixture roots, alive
  about 1h50m, about 2.6 GB resident, each launched with the fixture root as
  its project and instructed to begin its role loop. Reproduced directly: a
  stub prepended to PATH resolves inside a tmux pane to the real binary at
  the directory the shell startup file prepends.

  BL-458 and BL-817 both addressed reaping - tearing down what a fixture
  spawned, including on abnormal exit. Neither prevents the real binary from
  being reached, so even a perfect reaper still boots real agents for the
  duration of the run. This feature covers prevention at the source.

  A shim that depends on PATH precedence cannot hold across a shell that
  re-orders PATH. The fixture must name its stub by a path no shell startup
  file can re-order.

  Background:
    Given a role-lifecycle fixture root with an agent stub written into it

  # BL-1305 fixture-agent-binary-is-the-stub-01
  Scenario: The launch command names the fixture stub by a path, not a bare name
    When the fixture builds the launch command for a role
    Then the command names a path inside the fixture root
    And the command is not the bare agent name

  # BL-1305 fixture-agent-binary-is-the-stub-02
  Scenario: A same-named binary earlier on PATH does not displace the stub
    Given a directory holding a different binary of the same agent name is prepended to PATH
    When the fixture launches a role agent
    Then the fixture stub is what ran
    And the binary the prepended directory holds did not run

  # BL-1305 fixture-agent-binary-is-the-stub-03
  Scenario: No real agent process survives the fixture
    When the fixture scenarios have finished
    Then no process launched from the fixture root is the real agent binary
