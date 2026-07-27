Feature: The Onboarding Facilitator is renamed to the Onboarder without breaking a live agent

  The human's own word was "Onboarder" - it appears in BL-590's source quoting them
  twice. "Facilitator" entered at implementation time and had spread to 49 tracked
  files and 456 occurrences by the time the rename was ruled. So this is not
  bikeshedding: it is reverting a documented drift from the word the person who
  asked for the thing actually used.

  What makes the parcel non-trivial is that the agent is RUNNING while it lands.
  Five paths under `.swarmforge/operator/` form a contract between a shell launcher,
  a Babashka supervisor, a TypeScript reconcile CLI and the ancillary stop script.
  Rename them in some and not others and the build still passes - while a second
  supervisor starts alongside the first, or the documented stop route silently stops
  stopping the agent. Every scenario below is about that class of failure, not about
  the spelling.

  The dated record is deliberately excluded. Bounce evidence and closed tickets keep
  the words they were written with; a repo that rewrites its own history cannot be
  used to reconstruct what happened. The same exemption covers the small set of
  files whose subject IS this rename - this ticket and this feature file must name
  the old word to describe replacing it.

  Real supervisor processes are out of the acceptance suite's scope: the launcher's
  observable decision is whether it declines, and the existing supervisor tick test
  owns real-process coverage (scenario 09).

  Background:
    Given the rename from facilitator to onboarder has landed

  # BL-684 onboarder-rename-01
  Scenario: the old word survives only where it names its own history
    When live surface is searched for the old word
    Then every file still containing the old word is a record file that names its own history
    And no script, module, entrypoint, identifier or state file name contains the old word
    And the search excludes the dated record

  # BL-684 onboarder-rename-02
  Scenario Outline: every caller of a renamed path still resolves
    When <caller> is asked for the path it invokes
    Then that path exists in the repo
    And no caller names a path that does not exist

    Examples:
      | caller                      |
      | start_ancillary_services.sh |
      | stop_ancillary_services.sh  |
      | the launcher                |
      | the supervisor              |
      | the reconcile CLI           |
      | the supervisor tick test    |

  # BL-684 onboarder-rename-03
  Scenario: the renamed launcher declines to start beside a pre-rename supervisor
    Given a pre-rename supervisor is running and holds its old-named pid file
    When the renamed launcher is run
    Then the launcher declines to start
    And it reports the old-named live pid as the reason
    And the pre-rename supervisor is left running and untouched

  # BL-684 onboarder-rename-04
  Scenario: the launcher proceeds when no old-named supervisor is alive
    Given no supervisor is running under either name
    When the renamed launcher is run
    Then the launcher does not decline to start
    And the pid file it would claim is the new-named one

  # BL-684 onboarder-rename-05
  Scenario Outline: an old-named pid file that is not alive never blocks a start
    Given an old-named pid file exists and its pid is <pid state>
    When the renamed launcher is run
    Then the launcher does not decline to start

    Examples:
      | pid state      |
      | a dead process |
      | not a number   |
      | an empty file  |

  # BL-684 onboarder-rename-06
  Scenario Outline: the stop path clears the agent's artifacts under both names
    Given the agent has left a <artifact> under both the old and the new name
    When the ancillary stop path is run
    Then neither the old-named nor the new-named artifact remains

    Examples:
      | artifact       |
      | heartbeat      |
      | supervisor pid |
      | status file    |
      | stop sentinel  |

  # BL-684 onboarder-rename-07
  Scenario: a pre-rename heartbeat is never read as current liveness
    Given an old-named heartbeat file written before the rename
    When the renamed supervisor reports the agent's liveness
    Then it reports the agent as not yet heartbeating
    And it never reads the old-named heartbeat

  # BL-684 onboarder-rename-08
  Scenario: no live scenario is left without a step handler by the rename
    When every live feature file's steps are resolved against the step registry
    Then every step resolves to a handler
    And no scenario names a step the registry cannot match

  # BL-684 onboarder-rename-09
  Scenario: behaviour is unchanged by the rename
    When the supervisor tick test is run under the new names
    Then it passes

  # BL-684 onboarder-rename-10
  Scenario: the dated record keeps the words it was written with
    When the dated record is inspected
    Then the dated record still contains the old word
    And no file under the dated record was renamed or rewritten by this parcel

  # BL-684 onboarder-rename-11
  Scenario: a live ticket keeps its record slug but not the old vocabulary
    When a live ticket that described the agent as current vocabulary is inspected
    Then its file name still carries its own record slug
    And its content says onboarder instead of the old word
