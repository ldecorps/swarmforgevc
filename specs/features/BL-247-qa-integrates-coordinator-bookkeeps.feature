Feature: QA lands approved work on main; the coordinator only keeps the books

  # Baton epic (BL-242) sibling of BL-243. Operator ruling 2026-07-10 (via the
  # coordinator, evidence backlog/evidence/BL-243-integration-role-ruling-20260710
  # .md): "every agent should merge his branch with QA's. the only thing coordinator
  # does is that he physically moves the backlog tickets." Specifier design call =
  # candidate (a): QA becomes the integration point. Every worktree role already
  # merges up to QA's approved commit (existing merge-up protocol), so QA's branch
  # holds the integrated result; QA lands it on main. main is RETAINED as the
  # deliverable/PR target (the product goal is a PR into main). NOT candidate (b)
  # "retire main". This is a live-protocol change -> sequence carefully.

  Background:
    Given a pipeline ending at QA, with worktree roles merging up to QA's approved commit

  # BL-247 qa-integrates-01
  Scenario: QA lands the approved commit on main after the merge-up broadcast
    Given QA approved a parcel and broadcast merge-up to the worktree roles
    And every worktree role merged its branch up to QA's approved commit
    When integration runs
    Then QA fast-forwards main to the approved commit and pushes origin
    And the coordinator performs no git merge into main

  # BL-247 coordinator-bookkeeps-02
  Scenario: the coordinator only moves the ticket and promotes, running no git integration
    Given QA approved a parcel
    When the coordinator processes the approval
    Then it moves the ticket from active to done and promotes the next paused item
    And it runs no git merge or push

  # BL-247 issue-close-owner-03
  Scenario: closing the GitHub issue on merge moves to the integration owner
    Given an approved parcel whose ticket id is a GitHub issue
    When integration completes
    Then QA closes the issue with the merge commit
    And the coordinator does not run the issue-close step
