Feature: sync refuses to deploy a main tip whose code is not QA-approved

  The freshness CLI's sync is the one action that ships main to the running
  daemons. It must refuse when what it would deploy — the deployed code
  surface, committed or on disk — differs from what QA approved, and stay
  friction free for the routine bookkeeping drift that lands on main many
  times a day. The deployed code surface and the QA integration branch
  (swarmforge-QA) are defined in the ticket's spec resolution.

  Background:
    Given a freshness-tracked project repo with a main branch and a QA integration branch

  # BL-629 sync-refuses-non-qa-approved-main-01
  Scenario: Unapproved code drift refuses the sync naming only the offending commit
    Given main carries a commit changing the deployed code surface that is not an ancestor of the QA integration branch
    And main also carries a bookkeeping-only commit that is not an ancestor of the QA integration branch
    When a sync is requested
    Then the sync is refused with the documented refusal exit status
    And the refusal names the sha of the code commit
    And the refusal does not name the sha of the bookkeeping commit
    And no process is restarted and no recompile is run
    And the refusal states the remedy of landing through QA or rerunning with the explicit override

  # BL-629 sync-refuses-non-qa-approved-main-02
  Scenario Outline: Deployable drift keeps the routine sync friction free
    Given the drift on main since the last QA-landed commit is <drift>
    When a sync is requested
    Then the sync proceeds without refusal

    Examples:
      | drift            |
      | empty            |
      | bookkeeping-only |

  # BL-629 sync-refuses-non-qa-approved-main-03
  Scenario: A QA branch mid-review does not refuse a deployable main
    Given the QA integration branch carries review work that is not on main
    And the drift on main since the last QA-landed commit is bookkeeping-only
    When a sync is requested
    Then the sync proceeds without refusal

  # BL-629 sync-refuses-non-qa-approved-main-04
  Scenario: The explicit override deploys anyway and leaves a durable record
    Given main carries a commit changing the deployed code surface that is not an ancestor of the QA integration branch
    When a sync is requested with the explicit override
    Then the sync proceeds without refusal
    And a durable override record names the offending sha and when the override ran

  # BL-629 sync-refuses-non-qa-approved-main-05
  Scenario: An override never outlives the invocation that carried it
    Given main carries a commit changing the deployed code surface that is not an ancestor of the QA integration branch
    And a prior sync ran with the explicit override
    When a sync is requested without the override
    Then the sync is refused with the documented refusal exit status

  # BL-629 sync-refuses-non-qa-approved-main-06
  Scenario: report distinguishes a stale daemon from a stale daemon behind an unapproved tip
    Given a tracked process is stale against main
    And main carries a commit changing the deployed code surface that is not an ancestor of the QA integration branch
    When a report is requested
    Then the report states the main tip is not QA-approved
    And the report names the sha of the code commit
    And the report exits successfully without refusing

  # BL-629 sync-refuses-non-qa-approved-main-07
  Scenario: report on a QA-approved tip still reads as plain staleness
    Given a tracked process is stale against main
    And the drift on main since the last QA-landed commit is bookkeeping-only
    When a report is requested
    Then the report states the main tip is QA-approved
    And the report exits successfully without refusing

  # BL-629 sync-refuses-non-qa-approved-main-08
  Scenario: A missing QA integration branch fails closed
    Given the repo has no QA integration branch
    When a sync is requested
    Then the sync is refused with the documented refusal exit status
    And the refusal states the QA approval reference is missing

  # BL-629 sync-refuses-non-qa-approved-main-09
  Scenario: Uncommitted changes to the deployed code surface refuse the sync
    Given the drift on main since the last QA-landed commit is empty
    And an uncommitted modification exists under the deployed code surface
    When a sync is requested
    Then the sync is refused with the documented refusal exit status
    And the refusal names the modified path

  # BL-629 sync-refuses-non-qa-approved-main-10
  Scenario: Uncommitted bookkeeping changes never refuse the sync
    Given the drift on main since the last QA-landed commit is empty
    And an uncommitted modification exists outside the deployed code surface
    When a sync is requested
    Then the sync proceeds without refusal
