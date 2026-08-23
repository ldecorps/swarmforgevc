Feature: one shared bounded runner, sourced by both callers that hand-copied it

  Two files carry their own wall-clock-bounded subprocess runner with the same
  two hard-won traps written out twice: expedite_cli.bb's sh-bounded and
  babysitter_check.bb's run-bounded!, the second written by mirroring the
  first's docstring. Both exist because .destroyForcibly kills only the direct
  child, so the command must be a process-group leader killed as a group, and
  because dereferencing a destroyed process blocks while a surviving grandchild
  holds the stdout pipe. A trap that has to be remembered twice is a trap that
  will be got right once. The behaviour below is what the single shared runner
  must keep true for both callers.

  Background:
    Given a bounded runner with a wall-clock bound and a command to run under it

  # BL-1103 shared-bounded-runner-01
  Scenario: a command that outlives its bound is killed together with its children
    Given a command that spawns a child and neither exits before the bound
    When the bound expires
    Then the command and its child are both gone and the caller is told the bound expired

  # BL-1103 shared-bounded-runner-02
  Scenario: a timed-out command whose grandchild holds the output pipe still returns
    Given a command that exits at once after spawning a child that holds the output pipe open past the bound
    When the bound expires
    Then the caller receives its result within the bound rather than blocking on the pipe

  # BL-1103 shared-bounded-runner-03
  Scenario: a command that finishes inside its bound is reported as itself
    Given a command that exits before the bound with output on stdout and a non-zero code
    When the runner runs it
    Then the caller receives that exit code and that output, and is not told the bound expired
