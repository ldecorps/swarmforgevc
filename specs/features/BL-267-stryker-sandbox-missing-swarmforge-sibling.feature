# mutation-stamp: sha256=02c394133ac0312d9d0a018e9b276be8df2f60ecc63f857a40b86ad6b3a69ed8
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-11T01:17:13.990270877Z","feature_name":"Stryker mutation runs resolve every runtime-loaded repo-root sibling","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-267-stryker-sandbox-missing-swarmforge-sibling.feature","background_hash":"2cf828de82ea672da51a52e201590a8d952a83bd1a40c9123927dc91671884e1","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a runtime-loaded repo-root sibling resolves inside the Stryker sandbox","scenario_hash":"e65bf36e32571e58b47419c94ba9dbf9fe5fcc942d36a3dcda93857b73b81aba","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-11T01:17:13.990270877Z"}]}
# acceptance-mutation-manifest-end

Feature: Stryker mutation runs resolve every runtime-loaded repo-root sibling

  Background:
    Given the Stryker config lives in extension/ and mutates out/**/*.js
    And the sandbox availability mechanism is configured with the repo-root siblings that tests and code under test reach into

  # BL-267 stryker-sibling-sandbox-01
  Scenario Outline: a runtime-loaded repo-root sibling resolves inside the Stryker sandbox
    Given a test or the code under test resolves the repo-root <sibling> path at run time
    When the hardener runs the Stryker mutation dry run
    Then the dry run does not fail with ENOENT on the <sibling> path
    And the <sibling> path resolves inside the sandbox as it does in a normal run

    Examples:
      | sibling    |
      | pwa        |
      | swarmforge |
      | .github    |
      | docs       |

  # BL-267 stryker-sibling-sandbox-02
  Scenario: the compliance battery CLI is reachable from mutated recruiter code inside the sandbox
    Given mutated recruiter code shells swarmforge/scripts/compliance_battery.bb via a REPO_ROOT computed three levels up from out/recruiter/
    When the hardener runs the no-surviving-mutants gate on the recruiter files
    Then the run reaches mutant evaluation rather than aborting on a missing compliance_battery.bb

  # BL-267 stryker-sibling-sandbox-03
  Scenario: making siblings available does not widen the mutation scope
    Given a ticket whose changed files are scoped to out/**/*.js
    When the sandbox availability mechanism makes the sibling paths available
    Then the mutated set remains out/**/*.js only
