Feature: BL-1472 Revert and reapply commits are transparent to path attribution

  own-paths credits each delivered path from the subjects of the commits
  that touched it in the parcel's range, and since BL-1315 a path with an
  untagged touch is kept for the landing ticket, because a lander's own
  conflict resolution names no ticket and must not be excluded. A bounce
  revert and its repair (git revert of the revert, subject "Reapply") are
  untagged touches too, but they carry another ticket's content: on
  2026-09-07 QA reverted BL-1348's merge for a spec gap, restored it with
  a reapply, and own-paths for BL-1463 then kept forty paths including
  BL-1348's ruling-B implementation and tests, unapproved and mid-rework,
  as BL-1463's own; before the reapply the same call excluded them. A
  revert or reapply commit contributes nothing of its own: the paths it
  undoes or redoes belong to the commits it undoes or redoes. Every
  scenario runs against a fixture repository under mkdtemp with its own
  origin (BL-1390).

  Background:
    Given a fixture repository with an origin, a main branch, a reviewing branch, a landing ticket and an unlanded sibling ticket whose tagged commits were merged into the reviewing branch

  # BL-1472 a-reverted-and-reapplied-siblings-paths-are-still-the-siblings-01
  Scenario: a sibling's paths reverted and then reapplied on the reviewing branch are still attributed to the sibling
    Given the reviewing branch reverted the sibling's merge and then reapplied it, both commits untagged
    When the land step computes the landing ticket's own paths
    Then every path the sibling's tagged commits introduced is excluded as the sibling's
    And neither the revert nor the reapply counts as an untagged touch on those paths

  # BL-1472 the-landers-own-untagged-edit-still-rides-02
  Scenario: the landing ticket's own untagged edit on a shared path still keeps the path
    Given the landing ticket's chain carries an untagged commit that edits a path the sibling also touched
    When the land step computes the landing ticket's own paths
    Then that path is kept for the landing ticket with the sibling as a passenger, as BL-1315 decided

  # BL-1472 a-path-attributed-to-nobody-still-replays-03
  Scenario: a path touched only by untagged non-revert commits is still replayed
    Given a path at the tip that only untagged commits, none of them a revert or reapply, ever touched
    When the land step computes the landing ticket's own paths
    Then that path is in the replay set, as BL-1343 decided

  # BL-1472 a-revert-of-the-landers-own-commit-is-transparent-too-04
  Scenario: a revert of the landing ticket's own tagged commit is attributed to the landing ticket, not to nobody
    Given the reviewing branch reverted one of the landing ticket's own tagged commits
    When the land step computes the landing ticket's own paths
    Then the paths that revert touched are attributed to the landing ticket and carry no untagged touch
