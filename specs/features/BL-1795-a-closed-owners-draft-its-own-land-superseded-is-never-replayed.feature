Feature: BL-1795 A closed owner's draft its own land superseded is never replayed

  After a ticket lands tip-pure, QA records the approved tip it built from
  under the ticket's abandoned_commits. Every commit of the owner's in
  that tip's ancestry is already accounted for by the land: its lines
  either reached origin/main through the tip, or a later commit of the
  owner's rewrote or removed them before review. The land step still
  treats such a pre-land draft as a stray and cherry-picks it. When the
  owner's later commits rewrote the draft, the pick conflicts with the
  landed copy, no superseded ground holds, and the whole land escalates
  (closed BL-1779's 368d1569e5, BL-1655's land on 2026-09-29, on a
  Specification.MD path BL-1655 also edits). When they removed it, the
  pick applies cleanly and re-adds lines the owner dropped. Every scenario
  runs against a fixture repository under mkdtemp with its own origin
  (BL-1390).

  Background:
    Given a fixture repository with an origin and a main branch
    And a sibling ticket closed on origin/main whose done copy lists its approved tip under abandoned_commits

  # BL-1795 a-superseded-draft-on-the-landing-tickets-own-file-is-not-replayed-01
  Scenario: a closed owner's superseded draft on a file the landing ticket also edits is not replayed
    Given the sibling has a pre-land draft entry in a "shared" docs file, and its approved tip "rewrites" that entry
    And origin/main carries the sibling's landed copy of that file
    And the landing ticket's own commit adds its own entry to the shared docs file on the same role branch
    When the land step runs for the landing ticket at the tip
    Then it exits LAND_REPLAY and prints LAND_STRAY_SUPERSEDED naming the draft commit with the reason "ancestor-of-owner-abandoned"
    And the replay branch's tip carries the landing ticket's own entry and the sibling's landed entry, and none of the draft entry's lines

  # BL-1795 a-superseded-draft-that-would-apply-cleanly-is-not-replayed-02
  Scenario: a closed owner's superseded draft that would apply cleanly is not replayed either
    Given the sibling has a pre-land draft entry in a "sibling-only" docs file, and its approved tip "removes" that entry
    And origin/main carries the sibling's landed copy of that file
    And the landing ticket's own commit, which never touches the sibling-only docs file, is on the same role branch
    When the land step runs for the landing ticket at the tip
    Then it exits LAND_REPLAY and prints LAND_STRAY_SUPERSEDED naming the draft commit with the reason "ancestor-of-owner-abandoned"
    And the replay branch's tip carries the sibling's docs file byte-identical to origin/main's

  # BL-1795 a-closed-owners-commit-outside-its-abandoned-ancestry-still-escalates-03
  Scenario: a closed owner's conflicting commit outside its abandoned tips' ancestry still escalates by name
    Given the sibling has a commit made after its land, in the shared docs file, that adds a line origin/main lacks and conflicts with origin/main
    And the landing ticket's own commit adds its own entry to the shared docs file on the same role branch
    When the land step runs for the landing ticket at the tip
    Then it exits LAND_ESCALATE and the reason names the sibling's post-land commit
    And no LAND_STRAY_SUPERSEDED line names the sibling's post-land commit
