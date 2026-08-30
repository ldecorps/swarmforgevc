# mutation-stamp: sha256=05c7db8c7278a6c5399eee828d8282631c0316731f6c4fceb4e0f74f9661cd43
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-30T07:46:39.630370756Z","feature_name":"The pre-commit guard chain reports every violation in one refusal","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1252-commit-guard-chain-reports-every-violation.feature","background_hash":"a364eaa52974271f9f70f6ecb6965ac249082e467467d1ffc7800fc853d30dce","implementation_hash":"unknown","scenarios":[{"index":0,"name":"One refusal names every index-inspection guard the commit violates","scenario_hash":"08f1eb4dee21bdfa38b693b62337021b790b0886dd23c5ba5dcf59c6f93b5578","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-30T07:46:39.630370756Z"}]}
# acceptance-mutation-manifest-end

Feature: The pre-commit guard chain reports every violation in one refusal

  `swarmforge/git-hooks/pre-commit` runs four independent guards as four
  sequential commands under `set -euo pipefail`. The first guard that
  refuses aborts the hook, so the remaining guards never run. A commit that
  violates more than one guard is therefore reported one violation at a
  time: the committer fixes the first, re-commits, and only then learns of
  the second.

  Constitutional Article 4.4 already forbids exactly this of a reviewing
  role - "a reviewing role never bounces at the FIRST defect; finish the
  full checklist, send one bounce with every defect". This feature holds the
  mechanical gate to the same standard.

  The fourth guard, `check_property_suite_drift.sh`, runs
  `npm run test:properties`; the other three inspect the git index only.
  Completeness is therefore required within the cheap tier, and the
  expensive suite must not be paid for a commit already refused.

  This feature changes reporting completeness only. The set of commits
  refused is exactly the set the current chain refuses.

  Background:
    Given the shared git hooks are installed via core.hooksPath

  # BL-1252 commit-guard-complete-inventory-01
  Scenario Outline: One refusal names every index-inspection guard the commit violates
    Given a staged commit that violates <violations>
    When the commit is attempted
    Then the commit is refused
    And the refusal names every guard in <violations> and no other guard

    Examples:
      | violations                                          |
      | commit-size                                         |
      | ticket-deletion                                     |
      | pipeline-code-on-main                               |
      | commit-size and ticket-deletion                     |
      | ticket-deletion and pipeline-code-on-main           |
      | commit-size, ticket-deletion, pipeline-code-on-main |

  # BL-1252 commit-guard-complete-inventory-02
  Scenario: A commit violating nothing is still allowed
    Given a staged commit that violates nothing
    When the commit is attempted
    Then the commit is allowed

  # BL-1252 commit-guard-complete-inventory-03
  Scenario: An index-inspection violation does not pay for the property suite
    Given a staged commit that violates commit-size
    When the commit is attempted
    Then the commit is refused
    And the property suite is not run

  # BL-1252 commit-guard-complete-inventory-04
  Scenario: A guard that fails unexpectedly refuses the commit rather than passing it
    Given the ticket-deletion guard exits with an unexpected error rather than a refusal
    When the commit is attempted
    Then the commit is refused
    And the refusal names the guard that failed unexpectedly
