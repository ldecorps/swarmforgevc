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
