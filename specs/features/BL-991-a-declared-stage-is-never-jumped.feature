# mutation-stamp: sha256=77a69c185d9dbc133b33856dce3f4f4c6de05a5be045b33939c03ff187697a8f
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-22T22:25:20.008252957Z","feature_name":"A declared required_stages is binding","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-991-a-declared-stage-is-never-jumped.feature","background_hash":"8a13f08d0ff9d3fcbfb93f37512ef41c0395139e13454c318dbd6227f1546a71","implementation_hash":"unknown","scenarios":[{"index":0,"name":"A hop that would jump declared stages is delivered to the next declared stage","scenario_hash":"834ca14906055399c3d50c4c6025ceb8bf4b4047e581a1f37c5839e3e976e974","mutation_count":9,"result":{"Total":9,"Killed":9,"Survived":0,"Errors":0},"tested_at":"2026-08-22T22:25:20.008252957Z"},{"index":3,"name":"A hop routing already leaves alone is still delivered exactly as addressed","scenario_hash":"bafca7e99579b50a8f9db26fa6c223c9d4d6f92da0ca81e190c8b1301445c3f8","mutation_count":20,"result":{"Total":20,"Killed":20,"Survived":0,"Errors":0},"tested_at":"2026-08-22T22:25:20.008252957Z"}]}
# acceptance-mutation-manifest-end

Feature: A declared required_stages is binding

  BL-951 made a stage jump visible; it deliberately did not make it
  impossible, leaving that as a policy question. The operator has now ruled:
  where a ticket declares required_stages, the declaration binds and a
  declared stage cannot be jumped. Where a ticket declares nothing, sender
  judgement stands exactly as today.

  Today the router honours any forward address that is already a member of
  the effective set, so a coder addressing QA on a full-chain ticket is
  delivered straight to QA with cleaner, architect, hardender and documenter
  merely recorded as passed over.

  Background:
    Given the ticket "BL-991-probe" is active

  # BL-991 declared-stage-is-never-jumped-01
  Scenario Outline: A hop that would jump declared stages is delivered to the next declared stage
    Given required_stages routing is enabled
    And the ticket's required_stages declaration is <declaration>
    When the coder sends a git_handoff addressed to <addressed>
    Then the parcel is delivered to <delivered> and to no other role

    Examples:
      | declaration     | addressed | delivered |
      | full-chain      | QA        | cleaner   |
      | no-cleaner      | QA        | architect |
      | coder-cleaner-qa | architect | cleaner  |

  # BL-991 next-declared-stage-is-delivered-unchanged-02
  Scenario: A hop addressed to the next declared stage is delivered unchanged
    Given required_stages routing is enabled
    And the ticket's required_stages declaration is coder-cleaner-qa
    When the coder sends a git_handoff addressed to cleaner
    Then the parcel is delivered to the role it was addressed to and to no other role
    And the handoff envelope carries no routing_skipped header

  # BL-991 deferred-stage-is-not-recorded-as-skipped-03
  Scenario: A stage deferred by a binding rewrite is not recorded as skipped
    Given required_stages routing is enabled
    And the ticket's required_stages declaration is full-chain
    When the coder sends a git_handoff addressed to QA
    Then no routing-skips record names QA as skipped

  # BL-991 enforcement-reaches-only-where-routing-reaches-04
  Scenario Outline: A hop routing already leaves alone is still delivered exactly as addressed
    Given required_stages routing is <routing>
    And the ticket's required_stages declaration is <declaration>
    When <sender> sends a git_handoff addressed to <addressed>
    Then the parcel is delivered to the role it was addressed to and to no other role

    Examples:
      | routing  | declaration     | sender     | addressed |
      | enabled  | absent          | coder      | QA        |
      | enabled  | invalid         | coder      | QA        |
      | disabled | full-chain      | coder      | QA        |
      | enabled  | full-chain      | QA         | coder     |
      | enabled  | documenter-only | documenter | QA        |
