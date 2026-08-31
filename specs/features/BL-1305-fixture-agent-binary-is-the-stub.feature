Feature: An acceptance fixture never launches a real agent binary

  specs/pipeline/steps/roleLifecycleParkUnneededSteps.js intends to stub the
  agent command by writing an `exit 0` stub into a temporary directory and
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
  re-orders PATH. What this feature requires is the outcome - the stub is
  unconditionally what runs - and it deliberately names no mechanism for
  getting there. An earlier draft of scenario 01 required the launch command
  to name the stub by an absolute path; that route is refused by
  validate_agent's closed allowlist before anything launches, so it was
  retired on 2026-08-31 rather than swapped for a different mechanism
  mandate. See the ticket for the measurement.

  Background:
    Given a role-lifecycle fixture root with an agent stub written into it

  # BL-1305 fixture-agent-binary-is-the-stub-01
  Scenario: The agent command resolves to the fixture stub inside a pane shell
    When the fixture resolves the agent command in a pane shell
    Then the command resolves to the stub inside the fixture root
    And the command does not resolve to the real agent binary

  # BL-1305 fixture-agent-binary-is-the-stub-02
  Scenario: A startup file prepending a same-named binary does not displace the stub
    Given the pane shell's startup file prepends a directory holding a different binary of the same agent name
    When the fixture launches a role agent
    Then the fixture stub is what ran
    And the binary the prepended directory holds did not run

  # BL-1305 fixture-agent-binary-is-the-stub-03
  Scenario: No real agent process survives the fixture
    When the fixture scenarios have finished
    Then no process launched from the fixture root is the real agent binary
