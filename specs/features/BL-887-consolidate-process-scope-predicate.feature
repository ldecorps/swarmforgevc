Feature: BL-887 one shared process-scope predicate for the supervisor reaper and the orphan janitor
  BL-886's architect pass found real drift between the supervisor's
  job-in-scope? (cmdline leg: contains a scope path anywhere; cwd leg: starts
  with one) and the janitor's project-scoped-path? (both legs: starts-with).
  A vitest WORKER embeds its absolute node_modules path mid-string, so when
  its cwd is also unresolvable the janitor classifies it out of scope and
  reapable-hung-vitest? hard-gates the reap — the hung worker is never
  touched. One shared predicate with the supervisor's semantics closes the
  gap for both subsystems.

  Background:
    Given the scope path set is the canonical host root plus every registered role worktree

  # BL-887 shared-scope-predicate-01
  Scenario Outline: supervisor and janitor classify a process identically
    Given a process whose cmdline shape is "<cmdline-shape>"
    And whose resolved cwd is <cwd>
    When the supervisor scope check and the janitor scope check each classify the process
    Then both classify it as <classification>

    Examples:
      | cmdline-shape                                      | cwd                      | classification |
      | worker embedding an absolute scope path mid-string | unresolvable             | in scope       |
      | worker embedding an absolute scope path mid-string | under the host root      | in scope       |
      | launcher with a relative config path and no path   | under a role worktree    | in scope       |
      | launcher with a relative config path and no path   | unresolvable             | out of scope   |
      | command with no scope path anywhere                | outside every scope path | out of scope   |

  # BL-887 shared-scope-predicate-02
  Scenario: a hung live-parented worker with unresolvable cwd becomes a janitor reap candidate
    Given a hung property-lane vitest worker whose cmdline embeds an absolute scope path mid-string
    And the worker's cwd is unresolvable
    And the worker's parent is alive and the worker has exceeded the stale threshold
    When the janitor sweep classifies reap candidates
    Then the worker is a reap candidate
