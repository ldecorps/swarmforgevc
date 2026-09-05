# mutation-stamp: sha256=6b7121841010c24cd8247b29ebe693d3c1a343cb722a6fc8300cee6ad02593e7
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T21:11:29.469049949Z","feature_name":"BL-1432 The land walk ranges over the parcel, not the branch's history","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1432-the-land-walk-ranges-over-the-parcel.feature","background_hash":"cb78032b4ee0ddbacbe699a4147b9102157b329d88adc92ab8c120ad550158f1","implementation_hash":"unknown","scenarios":[{"index":3,"name":"a worktree with work in it is never re-pointed","scenario_hash":"ffa6ea32e8392bf935b01d51687a97ed5a83fb96482940c2096f5e4aeff268b4","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-05T21:11:29.469049949Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1432 The land walk ranges over the parcel, not the branch's history

  The land step walks origin/main..tip. On 2026-09-05 QA's branch was 1839
  commits ahead of main and 4 behind it, because tip-pure replays land a
  parcel's CONTENT under new SHAs on main while the QA branch keeps every
  review merge and every merge of main as its own history: none of those
  commits ever becomes a main ancestor, so the range grows by a few commits
  per ticket forever. Each walk spawns a git subprocess per delivered path
  over that whole range and takes 3.5 to 4.5 minutes, and the same history
  is reported as sixty-odd ENTANGLED_SIBLING lines naming done tickets.
  BL-1431 makes the walk immune to a ref that moves under it; this feature
  is about the cost and the noise. The human ruled option 3 on 2026-09-05:
  both mechanisms. The walk is bounded to the parcel's own base whatever
  history the branch carries (scenarios 01 and 02), and after each
  successful land QA's branch is re-pointed to origin/main when its
  worktree is clean and nothing is in process (scenarios 03 and 04).

  Background:
    Given a fixture repository with a bare origin, a main that already holds the content of many earlier parcels, and a QA-style branch whose history carries those parcels' review merges plus one new approved parcel

  # BL-1432 the-walk-visits-only-the-parcel-01
  Scenario: the attribution walk covers only commits the parcel introduced
    Given the new approved parcel is the parcel under land
    When the land plan for the parcel under land is computed
    Then every commit the attribution walk visits is one of that parcel's own
    And the verdict names the parcel's own paths and no entangled sibling

  # BL-1432 the-next-land-starts-from-the-parcel-again-02
  Scenario: after a successful land the next parcel's walk is again the parcel alone
    Given the new approved parcel has been landed and published
    And a further approved parcel added on the QA-style branch is the parcel under land
    When the land plan for the parcel under land is computed
    Then every commit the attribution walk visits is one of that parcel's own

  # BL-1432 a-clean-branch-is-re-pointed-after-a-land-03
  Scenario: after a successful land a clean QA branch is re-pointed to origin/main
    Given the new approved parcel has been landed and published
    And the QA-style worktree is clean and its in_process mailbox is empty
    When the post-land re-point runs
    Then the QA-style branch tip equals origin/main
    And the re-point is logged with the old tip and the new tip

  # BL-1432 a-busy-branch-is-never-re-pointed-04
  Scenario Outline: a worktree with work in it is never re-pointed
    Given the new approved parcel has been landed and published
    And the QA-style worktree holds <work>
    When the post-land re-point runs
    Then nothing about the branch or the worktree has moved
    And the skip is logged naming <work>

    Examples:
      | work                          |
      | an uncommitted change         |
      | a parcel in its in_process    |
