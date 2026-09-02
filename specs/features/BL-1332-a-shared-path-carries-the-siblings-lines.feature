Feature: The replay separates two tickets inside one shared path

  BL-1315 taught the land step's replay to exclude a path attributed wholly to
  an unlanded sibling. Attribution stops there, at the path, and the tip is
  built with `git checkout <cited-commit> -- <path>` - the whole blob. So a
  path BOTH tickets edited is pulled in by the landing ticket's ownership and
  carries the sibling's lines with it.

  On 2026-09-02 that shipped an unlanded ticket's `require(...)` line into
  `specs/pipeline/steps/index.js` on origin/main, whose handler file had not
  landed, and the registration guard then refused every role's commit on main
  until a specifier adjudicated by hand.

  The human ruled option 1: a shared path REFUSES the land, naming the path
  and the sibling, rather than shipping either ticket's version of the blob.
  Scenario 02 below is tightened to that shape. Splitting a shared path
  per-hunk so an entangled parcel still lands its own work is option 2 and a
  fair follow-up slice, once this has made the failure loud instead of silent.

  Background:
    Given the land step is replaying a cited commit for ticket "BL-A"
    And the same run reports ticket "BL-B" as an unlanded sibling

  # BL-1332 a-shared-path-carries-the-siblings-lines-01
  Scenario Outline: A single-owner path keeps the decision BL-1315 landed
    Given the cited commit changes a path attributed to "<owner>"
    When the land step computes the replay tip
    Then that path is "<disposition>" in the tip

    Examples:
      | owner  | disposition    |
      | BL-A   | replayed whole |
      | BL-B   | excluded       |
      | nobody | replayed whole |

  # BL-1332 a-shared-path-carries-the-siblings-lines-02
  Scenario: A shared path refuses the land rather than carrying the sibling's line
    Given the cited commit changes a path attributed to both "BL-A" and "BL-B"
    And that path holds one line contributed only by "BL-B"
    When the land step computes the replay tip
    Then the land is refused
    And the refusal names that path and "BL-B"
    And no tip is produced whose copy of that path contains "BL-B"'s line

  # BL-1332 a-shared-path-carries-the-siblings-lines-03
  Scenario: A shared path whose attribution cannot be read refuses the land
    Given the cited commit changes a path attributed to both "BL-A" and "BL-B"
    And that path's attribution cannot be read
    When the land step computes the replay tip
    Then the land is refused
    And the refusal names that path and "BL-B"
    And no partial tip is left behind

  # BL-1332 a-shared-path-carries-the-siblings-lines-04
  Scenario: A produced tip satisfies the guard that froze main
    Given the cited commit changes a path attributed to both "BL-A" and "BL-B"
    And that path is "specs/pipeline/steps/index.js"
    And "BL-B" contributed a handler registration to it but its handler file is absent
    When the land step computes the replay tip
    Then the feature-handler registration guard passes against every tip produced
