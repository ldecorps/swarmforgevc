Feature: BL-968 step registry loads from a materialized non-repo tree

  The BL-761 acceptance-contract gate materializes a cited commit's
  specs/pipeline into a non-git temp tree and loads the step registry
  there. Step files that run git at module load make that load fail, and
  the gate warns-and-skips - blind on effectively every send. The
  registry must load from a materialized tree, steps must bind
  environmental lookups lazily, and a standing guard must keep it that
  way.

  # BL-968 registry-materialized-load-01
  Scenario: the current registry loads from a materialized non-repo tree
    Given the current specs/pipeline tree materialized into a temp dir that is not a git repository
    When the contract step resolver runs against it
    Then the resolver reports the registry loadable with no unresolved steps attributable to load failure

  # BL-968 registry-materialized-load-02
  Scenario: the standing guard names a step file that shells out at module load
    Given a scratch registry tree containing a step file that runs a subprocess at module load
    When the standing guard runs against that tree
    Then the guard fails naming that step file

  # BL-968 registry-materialized-load-03
  Scenario: a QA-bound gate evaluation runs the acceptance-contract check without a registry-load warning
    Given a QA-bound git_handoff citing a commit whose registry contains the fixed step files
    When the pre-QA gate gathers and evaluates the send
    Then no step-registry-load warning is recorded
    And the acceptance-contract check produces a real verdict for the ticket

  # BL-968 registry-materialized-load-04
  Scenario: a fixed step file still resolves the main checkout at execution time
    Given a role-worktree checkout of the repository
    When a scenario step from a fixed step file executes and needs the main checkout
    Then it resolves the main checkout correctly at execution time
