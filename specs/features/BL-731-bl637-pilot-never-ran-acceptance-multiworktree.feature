Feature: lifecycle teardown tickets must run acceptance under multi-worktree conditions
  BL-731 (companion BL-730). BL-637's acceptance suite fails when a sibling
  worktree's handoffd.bb is running — the multi-worktree reality this repo
  runs daily. Running acceptance with only one worktree active can pass while
  hiding unscoped survivor scans. BL-727 made the pilot execute acceptance
  before land; this slice adds the environment contract for lifecycle/teardown
  tickets: acceptance must run under a realistic multi-worktree fixture, not
  an isolated single-worktree sandbox. Source: BL-723 review of BL-637.

  Background:
    Given the pilot acceptance gate is the only landing path
    And a lifecycle or teardown-script ticket declares an acceptance feature

  # BL-731 lifecycle-ticket-requires-multi-worktree-fixture-01
  Scenario: a lifecycle teardown ticket refuses land on single-worktree-only acceptance
    Given a lifecycle teardown ticket whose acceptance has not been executed under multi-worktree conditions
    When the pilot attempts to land the ticket
    Then the land is refused
    And the refusal names single-worktree-only acceptance as insufficient

  # BL-731 acceptance-runs-with-sibling-handoffd-02
  Scenario: lifecycle teardown acceptance executes with a sibling worktree handoffd active
    Given at least two worktrees for this repo are active
    And a sibling worktree has handoffd.bb running for its own root
    When the pilot runs the ticket's acceptance contract before land
    Then the acceptance pipeline executes under that multi-worktree fixture
    And the run records multi-worktree environment metadata

  # BL-731 multi-worktree-green-lands-with-receipt-03
  Scenario: a green multi-worktree acceptance run lands with environment on the receipt
    Given a lifecycle teardown ticket whose acceptance passes under multi-worktree conditions
    When the pilot lands the ticket
    Then the ticket yaml is moved to backlog/done/
    And the acceptance receipt records the multi-worktree fixture was used

  # BL-731 multi-worktree-failure-refuses-inert-04
  Scenario: a failed multi-worktree acceptance run refuses land without side effects
    Given a lifecycle teardown ticket whose acceptance fails under multi-worktree conditions
    When the pilot attempts to land the ticket
    Then the land is refused
    And the ticket yaml still sits in backlog/active/
    And no acceptance receipt is written
