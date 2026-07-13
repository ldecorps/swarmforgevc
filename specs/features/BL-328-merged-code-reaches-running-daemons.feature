Feature: Merged code actually reaches the long-lived processes that run it

# BL-328: a ticket can be built, QA-approved, merged and closed while the running daemons
# keep executing the code they loaded at startup — for days. Every surface reads healthy:
# ticket done, tests green, process alive, heartbeat fresh. Nothing anywhere says "the code
# you are running is not the code you merged". It defeats QA itself: QA verifies the source,
# production runs a stale artifact.

Background:
  Given a long-lived process that loaded its code when it started
  And newer code for that process has been merged to the main branch

# BL-328 merged-code-reaches-daemons-01
Scenario: A process running an older build than main is reported as stale
  When the swarm's health is reported
  Then that process is reported as running a stale build
  And the report names the build it is running and the build on main

# BL-328 merged-code-reaches-daemons-02
Scenario: A merge reaches the running processes with no human action
  When a change to a long-lived process's source is merged
  Then that process is running the merged code within the configured interval
  And no human action was required to make that happen

# BL-328 merged-code-reaches-daemons-03
Scenario Outline: Every long-lived process is covered, whatever language it is written in
  Given a long-lived <process_kind> process started before the merge
  When the swarm's health is reported
  Then that process is reported as running a stale build

  Examples:
    | process_kind |
    | compiled     |
    | interpreted  |

# BL-328 merged-code-reaches-daemons-04
Scenario: A supervisor respawn brings up the current build, not the dead process's build
  Given a long-lived process running a stale build crashes
  When its supervisor respawns it
  Then the respawned process runs the current build
  And the stale build is not re-armed

# BL-328 merged-code-reaches-daemons-05
Scenario: A restart loses no messages in either direction
  Given messages are in flight to and from the front desk
  When the affected processes are restarted to pick up new code
  Then every message is delivered exactly once
  And no message is dropped or duplicated

# BL-328 merged-code-reaches-daemons-06
Scenario: A process running the current build is not reported as stale
  Given a long-lived process started after the most recent merge
  When the swarm's health is reported
  Then that process is not reported as running a stale build
