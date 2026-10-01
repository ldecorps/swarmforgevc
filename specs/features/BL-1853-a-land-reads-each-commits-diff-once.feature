# mutation-stamp: sha256=c0f3401692badecf289b2e02579a32639f2e8f4205a342e82a9ebf500ce6a95d
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-10-01T11:42:21.115924978Z","feature_name":"BL-1853 A land reads each commit's diff once","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1853-a-land-reads-each-commits-diff-once.feature","background_hash":"dafc61f846ed4171efaa9af0dd7e18bc86e1ead6078686417945bd9472088e6a","implementation_hash":"unknown","scenarios":[{"index":1,"name":"an unusable cache entry is read again from git, never taken as an empty diff","scenario_hash":"252f2bfaf631a18c257164ad8706fd016f929eb381d3f39e106b5fc18de1ab6c","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-10-01T11:42:21.115924978Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1853 A land reads each commit's diff once

  The land plan walks every commit from origin/main to the cited tip, and
  for each ticket-tagged non-merge commit it runs git log -p to read what
  lines the commit changed. BL-1806 made the walk cheap over merges. It
  still pays one read per tagged commit on every land, and a commit's
  diff never changes. On 2026-09-30 the walk held 8069 commits, 3696 of
  them non-merges, because role branches keep every replayed ancestor. By
  the afternoon a land took 13 minutes, against 2 to 6 the evening
  before. A diff read once is now kept by its commit id, so a land reads
  only the commits no land has read before, and its verdict is the same
  as without the cache.

  Background:
    Given a fixture repository with its own bare origin and a tip holding 200 ticket-tagged commits since origin/main
    And the land plan has already run once over that tip

  # BL-1853 a-second-plan-reads-only-new-commits-01
  Scenario: a second land plan reads the diff of only the commits no plan has read
    Given 20 more ticket-tagged commits are added to the tip
    When the land plan runs again
    Then it reads a commit diff from git for exactly the 20 new commits
    And its verdict equals the verdict of a land plan with no cache

  # BL-1853 an-unusable-entry-is-read-again-02
  Scenario Outline: an unusable cache entry is read again from git, never taken as an empty diff
    Given the cache entry of one commit is <state>
    When the land plan runs again
    Then it reads that commit's diff from git
    And its verdict equals the verdict of a land plan with no cache

    Examples:
      | state                          |
      | missing                        |
      | corrupt                        |
      | written for a different commit |
