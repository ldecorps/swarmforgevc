# mutation-stamp: sha256=d90adf949b38bb6c1a9b4b2821d1e827fbb27e21ee5a74f56a84e82bdfdd6276
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T08:29:36.577782117Z","feature_name":"A ticket QA landed but never notified the coordinator about is detected","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1104-qa-landed-ticket-never-closed-strands-in-active.feature","background_hash":"7da8ff058362267cfdffba63d27177f4393957c13949f6c041ccf195c0b1fcd9","implementation_hash":"unknown","scenarios":[{"index":2,"name":"A ticket an existing sweep already owns is left to that sweep","scenario_hash":"235bc83de50b374c38149afb69df5f15efbea7c0b7bb10941aa7b3764e87ff05","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-24T08:29:36.577782117Z"}]}
# acceptance-mutation-manifest-end

Feature: A ticket QA landed but never notified the coordinator about is detected

  QA's landing sequence has four separable steps, and a session can stop after
  the push: the commit reaches origin/main but the coordinator is never told,
  so the ticket stays in backlog/active/ holding a depth-cap slot while the
  board reports landed work as in-flight.

  The two existing sweeps over active tickets cannot see this. Both ask
  whether a ticket has NO dispatch trail, and a ticket that walked the whole
  pipeline to QA has a complete one, so it reads as healthy to both. This is
  the third sibling sweep, which asks the opposite question.

  Background:
    Given the landed-but-open sweep runs over the active backlog and the main ref

  # BL-1104 landed-but-open-01
  Scenario: A ticket QA landed but never closed is flagged for a QA re-notify
    Given active ticket "BL-2001" whose QA approval is reachable from the main ref
    And no close commit for "BL-2001" on the main ref
    When the sweep runs
    Then "BL-2001" is flagged as landed-but-open
    And QA is nudged to resend the coordinator notify for "BL-2001"
    And the nudge names the approval commit that flagged it

  # BL-1104 landed-but-open-02
  Scenario: A ticket still under QA review is not flagged
    Given active ticket "BL-2002" whose parcel has reached QA
    And no QA approval for "BL-2002" is reachable from the main ref
    When the sweep runs
    Then "BL-2002" is not flagged

  # BL-1104 landed-but-open-03
  Scenario Outline: A ticket an existing sweep already owns is left to that sweep
    Given active ticket "<ticket>" with <condition> and no QA approval on the main ref
    When the sweep runs
    Then "<ticket>" is not flagged
    And the "<owner>" sweep still returns "<ticket>"

    Examples:
      | ticket  | condition          | owner             |
      | BL-2003 | no dispatch trail  | dispatch-gap      |
      | BL-2004 | no assignee        | unassigned-active |

  # BL-1104 landed-but-open-04
  # Trap (a), measured live: git log --grep matches the commit BODY, so
  # grepping origin/main for BL-1078 returns BL-1086's landing commit.
  Scenario: A ticket named only in another ticket's commit body is not flagged
    Given active ticket "BL-2005" with no QA approval of its own
    And a commit on the main ref whose subject names "BL-2006" and whose body mentions "BL-2005"
    When the sweep runs
    Then "BL-2005" is not flagged

  # BL-1104 landed-but-open-05
  Scenario: A ticket already nudged is not nudged again by the next sweep
    Given active ticket "BL-2007" flagged as landed-but-open
    And a QA re-notify nudge for "BL-2007" is already on record
    When the sweep runs again
    Then no second nudge for "BL-2007" is sent

  # BL-1104 landed-but-open-06
  Scenario: The sweep never closes or moves the ticket itself
    Given active ticket "BL-2008" whose QA approval is reachable from the main ref
    When the sweep runs
    Then "BL-2008" is still in the active backlog
    And no backlog file has been moved or closed by the sweep
