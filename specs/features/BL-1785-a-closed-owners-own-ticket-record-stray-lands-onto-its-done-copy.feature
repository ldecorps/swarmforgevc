Feature: BL-1785 A closed owner's own ticket-record stray lands onto its done copy

  QA records bookkeeping on a ticket's file after that ticket lands. The
  commonest case is `abandoned_commits:` naming the parcel commits the
  tip-pure land superseded. It goes onto the ticket's backlog/active/ copy
  on QA's own branch, and the coordinator's close then moves the file to
  backlog/done/ on main. The next land walks a tip that still carries the
  pre-close active copy. Its only owner is closed on origin/main, so
  BL-1546 refuses and every such land escalates to a hand build. It hit
  BL-1768's own land on 2026-09-26, and BL-1757's record e1a80051f4
  (15:34:27, closed 15:35:28) arms the next one. Dropping the record is no
  fix either. The land step unions abandoned_commits across every copy of
  a ticket to disclaim that ticket's stray commits, so a lost line stops
  disclaiming them. BL-1650 already lands a closed owner's pure-evidence
  stray by cherry-pick. This feature widens the stray's allowed paths by
  exactly one: the owner's OWN ticket file under backlog/active/ or
  backlog/paused/. git's rename detection carries the edit onto
  origin/main's backlog/done/ copy. BL-1546's refusal is unchanged for
  anything wider. Every scenario runs against a fixture repository under
  mkdtemp with its own origin (BL-1390).

  Background:
    Given a fixture repository with an origin and a main branch
    And a sibling ticket whose file origin/main has moved from backlog/active/ to backlog/done/M8/

  # BL-1785 a-closed-owners-record-edit-lands-onto-its-done-copy-01
  Scenario: a closed owner's own record edit lands onto its done copy
    Given a commit on a role branch, whose subject leads with the sibling's id, adding "abandoned_commits: [abcdef1234]" to the sibling's backlog/active/ file
    And the landing ticket's own commit is on the same role branch
    When the land step runs for the landing ticket at the tip
    Then it exits LAND_REPLAY and prints LAND_STRAY_EVIDENCE_LANDED naming the stray's own commit
    And the replay branch's tip carries "abandoned_commits: [abcdef1234]" exactly once in the sibling's backlog/done/M8/ file
    And the replay branch's tip has no file for the sibling under backlog/active/ or backlog/paused/

  # BL-1785 a-record-edit-the-done-copy-already-carries-is-not-landed-twice-02
  Scenario: a record edit the done copy already carries is reported already landed
    Given origin/main's backlog/done/M8/ file for the sibling already carries "abandoned_commits: [abcdef1234]"
    And a commit on a role branch, whose subject leads with the sibling's id, adding "abandoned_commits: [abcdef1234]" to the sibling's backlog/active/ file
    And the landing ticket's own commit is on the same role branch
    When the land step runs for the landing ticket at the tip
    Then it exits LAND_REPLAY and prints LAND_STRAY_EVIDENCE_ALREADY_LANDED naming the stray's own commit
    And the replay branch's tip carries "abandoned_commits: [abcdef1234]" exactly once in the sibling's backlog/done/M8/ file
    And the replay branch's tip has no file for the sibling under backlog/active/ or backlog/paused/

  # BL-1785 a-stray-wider-than-its-owners-own-record-still-refuses-03
  Scenario Outline: a closed-owner stray wider than its owner's own record still refuses by name
    Given a commit on a role branch, whose subject leads with the sibling's id, editing the sibling's backlog/active/ file and "<other path>"
    And the landing ticket's own commit is on the same role branch
    When the land step runs for the landing ticket at the tip
    Then it exits LAND_ESCALATE and the reason names "<other path>" and the sibling's id
    And no LAND_STRAY_EVIDENCE_LANDED line is printed

    Examples:
      | other path                                 |
      | swarmforge/scripts/bl9785_fixture_lib.bb   |
      | backlog/active/BL-9786-another-ticket.yaml |
