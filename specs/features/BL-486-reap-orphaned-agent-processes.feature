Feature: the swarm auto-reaps orphaned SwarmForge agent processes, and never a live agent

  # Onboarding / second-swarm bring-up DRY-RUNS (e.g. FES) launch claude agents
  # with --remote-control SwarmForge-<role> from a /tmp/tmp.XXXX mktemp checkout
  # and do not always tear them down, so long-abandoned agent processes
  # accumulate (a 6h43m-old orphaned coder was found and killed by hand this
  # session: cwd already `(deleted)`, 0 children, ~0% CPU). The swarm should reap
  # these itself.
  #
  # This is HIGH-RISK: auto-killing claude processes is the exact class behind
  # BL-367, where an unscoped socket glob killed the LIVE swarm five times in one
  # session. So the reaper NEVER matches a process pattern straight to kill; it
  # evaluates every candidate pid against a defensive predicate whose exclusions
  # win FIRST — the live control socket's tmux window set (the decapitation
  # guard), a cwd still rooted inside this repo, any live children, and a
  # too-young age (which protects an in-progress dry-run such as an active FES
  # bring-up). Only a genuinely-orphaned candidate that clears every gate is
  # killed, and every kill is audit-logged. The pure decision below is the same
  # shape and posture as BL-458's fixture-reaper `reapable?` (socket-root wins
  # first); the wiring scenarios prove the real sweep against a PRIVATE fixture,
  # never the real /proc or a live swarm.

  Background:
    Given the orphaned-agent reaper

  # BL-486 reap-orphaned-agent-processes-01
  Scenario Outline: an orphaned agent pid is reaped only when it clears every safety gate, and the live-window-set exclusion wins first
    Given the candidate pid being a member of the live control socket's tmux window set is "<in_window_set>"
    And its cwd still resolving inside this repo root is "<cwd_inside_root>"
    And it being a SwarmForge remote-control agent process is "<remote_control_agent>"
    And it having live child processes is "<has_children>"
    And its age past the stale threshold is "<is_stale>"
    When the reaper evaluates the candidate
    Then the agent process is killed is "<reaped>"

    Examples:
      | in_window_set | cwd_inside_root | remote_control_agent | has_children | is_stale | reaped |
      | no            | no              | yes                  | no           | yes      | yes    |
      | yes           | no              | yes                  | no           | yes      | no     |
      | no            | yes             | yes                  | no           | yes      | no     |
      | no            | no              | no                   | no           | yes      | no     |
      | no            | no              | yes                  | yes          | yes      | no     |
      | no            | no              | yes                  | no           | no       | no     |

  # BL-486 reap-orphaned-agent-processes-02
  Scenario: a real sweep reaps a genuinely-orphaned agent and records one audit line per kill
    Given a candidate agent process that is old, has a deleted working directory, has no children, and is not in any live window set
    When the orphaned-agent reaper sweep runs against a private fixture
    Then that candidate process is killed
    And the audit log gains exactly one entry naming that pid

  # BL-486 reap-orphaned-agent-processes-03
  Scenario: the reaper never kills a process in the live control socket's tmux window set, regardless of age
    Given an old agent process whose pid is a member of the live control socket's tmux window set
    When the orphaned-agent reaper sweep runs against a private fixture
    Then that process is left running
    And no audit line is written for that pid
