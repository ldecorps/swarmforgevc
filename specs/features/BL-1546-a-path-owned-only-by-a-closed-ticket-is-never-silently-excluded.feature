Feature: BL-1546 A path owned only by a closed ticket is never silently excluded

  own-paths excludes a delivered path whose every owner - the ticket ids
  named by the subjects of the commits that touched it in the parcel's
  range - is an unlanded sibling. Unlanded is decided on content: the
  owner's own added lines are not on origin/main. For a commit the parcel
  itself authored they never are, so a commit whose subject names only a
  ticket CLOSED on origin/main (its file under backlog/done/) has an owner
  that reads unlanded forever, and the path is dropped with one
  EXCLUDED_SIBLING_PATH line: on 2026-09-12 the documenter's "docs:
  BL-1518 guard how-to and feature narrative no longer overclaim every
  draft's location" (5dbd34f27f), BL-1537's own task-4 deliverable, was
  excluded from BL-1537's replay as BL-1518's, a ticket done since
  9d5aa7cef2. A path whose owners are all closed is never decided
  silently: kept when the landing ticket touches it itself, otherwise
  refused by name. Closed is a positive finding read from origin/main's
  backlog/done/; an owner still filed under active/ or paused/ keeps
  today's exclusion. Every scenario runs against a fixture repository
  under mkdtemp with its own origin (BL-1390).

  Background:
    Given a fixture repository with an origin, a main branch, a reviewing branch, a landing ticket, and a sibling ticket whose YAML is filed under backlog/done/ on origin/main

  # BL-1546 a-closed-owner-path-with-the-landers-own-touch-keeps-the-path-01
  Scenario: a closed-owner path the landing ticket also touched is kept for the landing ticket
    Given a commit on the reviewing branch touching a path whose subject names only the closed sibling's id and leads with none
    And a commit whose subject leads with the landing ticket's id also touches that path
    When the land step computes the landing ticket's own paths
    Then that path is kept for the landing ticket with the closed sibling reported as a passenger, neither excluded nor refused

  # BL-1546 a-closed-owner-path-with-no-own-touch-refuses-by-name-02
  Scenario: a closed-owner path no commit of the landing ticket's touched refuses the land by name instead of excluding the path
    Given a commit on the reviewing branch touching a path whose subject names only the closed sibling's id and leads with none
    And that path's content at the tip differs from origin/main
    And no commit naming the landing ticket touches that path
    When the land step runs for the landing ticket at the tip
    Then it exits LAND_ESCALATE and the reason names that commit, the closed sibling's id, and the path
    And the path is never printed as an EXCLUDED_SIBLING_PATH

  # BL-1546 a-closed-owner-path-whose-content-main-already-has-is-not-refused-03
  Scenario: a closed-owner path whose content is already on origin/main neither refuses nor excludes
    Given a commit on the reviewing branch touching a path whose subject names only the closed sibling's id and leads with none
    And that path's content at the tip is identical to origin/main
    When the land step runs for the landing ticket at the tip
    Then the land proceeds with no refusal and no exclusion for that path

  # BL-1546 an-open-owner-path-is-still-excluded-as-before-04
  Scenario: a path whose only owner is still filed under backlog/active/ on origin/main is excluded exactly as before
    Given the sibling ticket's YAML is filed under backlog/active/ on origin/main instead of backlog/done/
    And a commit on the reviewing branch touching a path whose subject names only the sibling's id and leads with none
    And that path's content at the tip differs from origin/main
    And no commit naming the landing ticket touches that path
    When the land step runs for the landing ticket at the tip
    Then it exits LAND_REPLAY and prints that path as an EXCLUDED_SIBLING_PATH owned by the sibling
