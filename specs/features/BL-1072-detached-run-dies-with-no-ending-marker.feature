Feature: BL-1072 a detached run's log always reaches a terminal state
  detach_job.sh documents two endings for a detached run: EXIT=<code> when it
  finishes, or KILLED by SIGTERM when something kills it. The hardener's rule
  drew the consequence as a guarantee - neither marker means it is still
  running - and instructed its reader to collect results by reading those
  markers and never by inferring from silence.

  A third outcome exists on this host: a registered run dying with neither
  ending and no notice in its own log, leaving children orphaned under its
  pgid. Read by the rule as written, that log says "still running", so its
  owner waits on a corpse. The failure is invisible in precisely the place
  they were told to look.

  BL-995 fixed one instance of this shape by appending the reaper's kill to
  the job's own log rather than only to the supervisor's. That fix assumed
  every kill flows through that path. This feature is the contract that holds
  however the job dies: the run's own log reaches a terminal state, and it
  says so where its owner is looking.

  Background:
    Given a detached job registered by detach_job.sh

  # BL-1072 terminal-state-01
  Scenario Outline: a run that stops producing output has said why in its own log
    Given the job's run ends by "<ending>"
    When its owner reads the job's own log and no other file
    Then the log has reached a terminal state
    And the reason names the process group

    Examples:
      | ending                                      |
      | finishing normally                          |
      | a SIGTERM the wrapper traps                 |
      | a signal the wrapper does not trap          |
      | its worker dying while the registration stands |

  # BL-1072 owner-visible-notice-02
  Scenario: the kill is recorded where the owner looks, not only in the daemon log
    Given the job is killed by the reaper
    When its owner reads the job's own log and no other file
    Then the death is discoverable from that log alone

  # BL-1072 silence-is-not-alive-03
  Scenario: a vanished group is never reported as still running
    Given the job's process group no longer exists
    When its owner asks whether the run is still going
    Then the answer is that the run is dead
    And the answer does not depend on the log having an ending marker

  # BL-1072 registration-spares-the-whole-tree-04
  Scenario: a live registration spares every part of the job's tree
    Given the job's registration is live and unexpired
    And the job's work runs across several processes
    When the orphan reap runs
    Then no part of the job's process tree is signalled

  # BL-1072 unregistered-orphan-unchanged-05
  Scenario Outline: the reaper's existing behaviour is untouched
    Given a job group that is "<registration>"
    When the orphan reap runs
    Then the group is reaped
    And the reason is appended to that job's own log

    Examples:
      | registration            |
      | registered but expired  |
      | never registered at all |
