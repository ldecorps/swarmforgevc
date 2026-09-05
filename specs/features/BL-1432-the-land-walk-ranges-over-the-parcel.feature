Feature: BL-1432 The land walk ranges over the parcel, not the branch's history

  The land step walks origin/main..tip. On 2026-09-05 QA's branch was 1839
  commits ahead of main and 4 behind it, because tip-pure replays land a
  parcel's CONTENT under new SHAs on main while the QA branch keeps every
  review merge and every merge of main as its own history: none of those
  commits ever becomes a main ancestor, so the range grows by a few commits
  per ticket forever. Each walk spawns a git subprocess per delivered path
  over that whole range and takes 3.5 to 4.5 minutes. BL-1431 makes the
  walk immune to a ref that moves under it; this feature is about the cost,
  which is what made the race likely in the first place and which every
  land pays. The mechanism is the human's ruling (see the ticket); the
  scenarios hold under each option because they assert the range the walk
  covers, not how the branch got there.

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
