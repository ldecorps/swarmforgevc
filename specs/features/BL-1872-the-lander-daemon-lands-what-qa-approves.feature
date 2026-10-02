Feature: BL-1872 The lander daemon lands what QA approves, so QA's turn ends at approval

  Today QA lands each approved parcel itself, with land_main_publish.sh
  --land, inside its own turn. On 2026-10-01 QA held a ticket for a median
  of 21 minutes, and nothing downstream moved while it did. Once a parcel
  travels on its own line (BL-1871), landing it needs no judgement: merge
  origin/main in, fast-forward push, record the approval, tell the
  coordinator. From this ticket on, QA's last act on a parcel is to queue
  the approval, and handoffd's lander sweep runs the land in a worktree of
  its own, never QA's. A land the sweep cannot complete goes back to QA
  with the land step's own reason. The one rematch a land allows no longer
  leaves its worktree on a detached HEAD, and the commit it rebuilds gets
  its own land approval record, so the commit that reaches main is never
  one the Article 4.2 check reads as unapproved.

  Background:
    Given a fixture project with a bare origin and a lander queue

  # BL-1872 queueing-an-approval-ends-qas-part-01
  Scenario: QA queues an approved parcel and the queue command runs no land
    Given QA has approved BL-9001 at a commit on BL-9001's own line
    When QA queues the land of BL-9001 at that commit
    Then the lander queue holds one entry naming BL-9001 and that commit
    And origin/main has not changed

  # BL-1872 the-sweep-lands-a-queued-approval-02
  Scenario: the lander sweep lands a queued approval and tells the coordinator
    Given the lander queue holds an entry for BL-9001 at a commit on BL-9001's own line
    When the lander sweep runs until the queue is empty
    Then origin/main carries BL-9001's change
    And the land approval for BL-9001 is recorded
    And the coordinator's inbox holds the bookkeeping note for BL-9001
    And the queue entry for BL-9001 is marked landed

  # BL-1872 lands-run-one-at-a-time-oldest-first-03
  Scenario: two queued approvals land one at a time, oldest first
    Given the lander queue holds entries for BL-9001 and then BL-9002, each on its own line
    When the lander sweep runs until the queue is empty
    Then origin/main carries BL-9001's change before BL-9002's
    And no two lands ran at the same time

  # BL-1872 a-refused-land-goes-back-to-qa-04
  Scenario Outline: a land the sweep cannot complete goes back to QA
    Given the lander queue holds an entry for BL-9001 whose land <fails>
    When the lander sweep runs until the queue is empty
    Then QA's inbox holds a note naming BL-9001 and the land step's reason
    And the queue entry for BL-9001 is marked refused
    And origin/main has not changed

    Examples:
      | fails                                                  |
      | conflicts with origin/main                             |
      | is refused by the land step with LAND_ESCALATE         |

  # BL-1872 an-approval-queued-twice-lands-once-05
  Scenario: the same approval queued twice lands once
    Given QA queues the land of BL-9001 at the same commit twice
    When the lander sweep runs until the queue is empty
    Then origin/main carries exactly one landing commit for BL-9001

  # BL-1872 a-rematched-land-leaves-no-worktree-detached-06
  Scenario: a land whose first push loses the race to origin/main rematches without detaching any worktree
    Given the lander queue holds an entry for BL-9001 at a commit on BL-9001's own line
    And origin/main moves after the land is built and before it is pushed
    When the lander sweep runs until the queue is empty
    Then origin/main carries BL-9001's change
    And QA's worktree and the lander's worktree are each still on their own branch

  # BL-1872 a-rematched-land-records-the-commit-it-published-07
  Scenario: a land whose first push loses the race records its approval against the rematched commit it published
    Given the lander queue holds an entry for BL-9001 at a commit on BL-9001's own line
    And origin/main moves after the land is built and before it is pushed
    When the lander sweep runs until the queue is empty
    Then the land approvals hold a record for the commit origin/main carries for BL-9001
    And that record names the queued commit as its source
