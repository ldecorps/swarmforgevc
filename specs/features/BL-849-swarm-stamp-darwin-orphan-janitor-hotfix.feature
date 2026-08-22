Feature: A reaper that cannot see the process table says so, instead of reporting a clean host
  On 2026-08-07 `operator_runtime` logged `orphan-janitor-sweep swept 0
  candidate(s), reaped 0` on every tick while ~30 disposable front-desk bots,
  worktree `babysitterd.sh` processes and stale `bl647.sock` tmux sessions ran
  on the host. The candidate scan read `/proc`, which does not exist on Darwin,
  so the candidate set was empty every time. A silent no-op reaper is
  indistinguishable from a clean host — that is the defect, not the leak.

  Background:
    Given a host running the orphan janitor sweep

  # BL-849 darwin-orphan-janitor-01
  Scenario: a host with nothing to reap reports a clean sweep
    Given the process table can be enumerated
    And no disposable-root ancillary process is running
    When the sweep runs
    Then it reports zero candidates
    And it reports the enumeration succeeded

  # BL-849 darwin-orphan-janitor-02
  Scenario: a host whose process table cannot be read reports the check unavailable
    Given the process table cannot be enumerated
    When the sweep runs
    Then it reports the check unavailable
    And it does not report a clean sweep

  # BL-849 darwin-orphan-janitor-03
  Scenario Outline: disposable-root ancillaries are found on either platform
    Given the process table is enumerated via <mechanism>
    And an ancillary process is running under a disposable root
    When the sweep runs
    Then that process is listed as a candidate

    Examples:
      | mechanism           |
      | the Linux proc tree |
      | the Darwin process handle API |

  # BL-849 darwin-orphan-janitor-04
  Scenario Outline: an ancillary is recognised however its command line names it
    Given an ancillary process whose command line is <command line>
    And it is rooted under a disposable root
    When the sweep runs
    Then that process is listed as a candidate

    Examples:
      | command line                     |
      | a bare babysitterd script name   |
      | an absolute path to the tmux binary |

  # BL-849 darwin-orphan-janitor-05
  Scenario: a process rooted in the host repo is never a candidate
    Given a process whose working directory is inside the host repository
    When the sweep runs
    Then it is not listed as a candidate
    And no reap decision is taken against it

  # BL-849 darwin-orphan-janitor-06
  Scenario: a process with no resolvable root is never reaped
    Given an ancillary process whose working directory cannot be resolved
    When the sweep runs
    Then it is not listed as a candidate
