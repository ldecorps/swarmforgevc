# mutation-stamp: sha256=25b01f912b5a107e45b478e18a05f5c90c772db0c0ee1a36fafd99f882c25b32
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-29T02:32:43.146774032Z","feature_name":"The reference-freshness guard refuses only for amendments the worktree is missing","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1237-reference-freshness-guard-is-direction-aware.feature","background_hash":"06af192ddfd6d04b46217bb64ee1918b505253f31d0d80930eb7cc850cbd4ec8","implementation_hash":"unknown","scenarios":[{"index":0,"name":"Only a worktree missing main's amendment is refused","scenario_hash":"ca634a5452775fe7e99b383a62ee8cfc5ba730952ecdf804e431065acba1ee7a","mutation_count":12,"result":{"Total":12,"Killed":12,"Survived":0,"Errors":0},"tested_at":"2026-08-29T02:32:39.615169949Z"}]}
# acceptance-mutation-manifest-end

Feature: The reference-freshness guard refuses only for amendments the worktree is missing
  BL-640's pre-turn guard refuses a role's turn when its copy of
  swarmforge/constitution/articles/reference/ differs from main's, so nobody
  acts on a stale elaboration. It compares content hashes and treats ANY
  difference as staleness.

  A pipeline worktree is routinely AHEAD of main - that is what an in-flight
  parcel looks like - and a ticket whose required_stages fast-track it
  straight from coder to QA puts its content into sibling worktrees, through
  ordinary branch merges, long before QA lands it on main. The guard reads
  that as drift and refuses. Its own prescribed remedy, "merge main and run
  again", is a no-op in that direction, and there is no bypass, so the role
  is blocked every turn until an unrelated ticket clears QA.

  The refusal must key on what the worktree is MISSING, and every refusal must
  name a remedy the refused role can actually carry out.

  Background:
    Given a role worktree and main both carry the reference elaboration files

  # BL-1237 reference-freshness-direction-01
  Scenario Outline: Only a worktree missing main's amendment is refused
    Given main's version of a reference file is <reachability> the worktree's history
    And the worktree's copy of that file <differs> from main's
    When the role runs its pre-turn freshness guard
    Then the turn is <outcome>

    Examples:
      | reachability     | differs         | outcome  |
      | not reachable in | differs         | refused  |
      | not reachable in | does not differ | allowed  |
      | already in       | differs         | allowed  |
      | already in       | does not differ | allowed  |

  # BL-1237 reference-freshness-direction-02
  Scenario: A worktree ahead via a fast-tracked sibling ticket is not blocked
    Given a ticket that skips this role has landed reference-file changes on another branch
    And this worktree has merged that branch but main has not yet received it
    When the role runs its pre-turn freshness guard
    Then the turn is allowed
    And the worktree's newer copy of the reference files is left untouched

  # BL-1237 reference-freshness-direction-03
  Scenario: A worktree genuinely behind is still refused, and told what to do
    Given main carries a reference-file amendment this worktree has never merged
    When the role runs its pre-turn freshness guard
    Then the turn is refused
    And the refusal names every file the worktree is missing
    And the refusal names a remedy that resolves the refusal when performed
