# mutation-stamp: sha256=2b22ce0395780a1663cd18b376f18a365b684d384f71fd519eff15070b19498c
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-29T08:31:04.016849179Z","feature_name":"A retired ticket's artefacts cannot come back through a merge","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1258-a-retirement-is-durable-across-branches.feature","background_hash":"2d8bfe945422cef8881107fe8df3c2c7af1b66574b6730b3e92c8bcca67cfa6e","implementation_hash":"unknown","scenarios":[{"index":3,"name":"A retirement holds however the artefacts reached the target's history","scenario_hash":"6ee87e471da096398d962e2ab5b91542b534fe4346bf68be1241a475426b075b","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-29T08:31:04.016849179Z"}]}
# acceptance-mutation-manifest-end

Feature: A retired ticket's artefacts cannot come back through a merge
  Retiring a ticket is adjudicated once, but the artefacts live on every branch
  that merged the mint. A deletion that lands on main is durable — a later merge
  resolves it as delete-vs-unchanged. An absence on main is not: a branch still
  holding the files presents them as a clean one-sided add and git takes them
  with no conflict. This is the addition-side twin of BL-1242.

  Background:
    Given a ticket id "BL-retired" that has been retired
    And a branch that still carries the artefacts minted under "BL-retired"

  # BL-1258 a-retirement-is-durable-across-branches-01
  Scenario: A merge that re-adds a retired ticket's artefacts is refused
    Given the retired artefacts are absent from the merge target
    When that branch is merged toward the target
    Then the merge is refused
    And the refusal names each artefact path belonging to "BL-retired"

  # BL-1258 a-retirement-is-durable-across-branches-02
  Scenario: A live ticket's new files are still allowed through
    Given a branch adding files owned by a ticket that has not been retired, which the merge target does not yet have
    When that branch is merged toward the target
    Then the merge is allowed

  # BL-1258 a-retirement-is-durable-across-branches-03
  Scenario: Retirement is recorded once, for every branch to read
    When "BL-retired" is retired
    Then the retirement record names every artefact path retired with it
    And the record is readable from a branch that never carried the artefacts

  # BL-1258 a-retirement-is-durable-across-branches-04
  Scenario Outline: A retirement holds however the artefacts reached the target's history
    Given the artefacts of "BL-retired" reached the merge target's history by "<route>"
    When a branch still carrying those artefacts is merged toward the target
    Then the merge is refused

    Examples:
      | route                                  |
      | landed-then-deleted-on-the-target      |
      | never-landed-on-the-target             |
