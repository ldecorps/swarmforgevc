Feature: A sync merge is not credited with its passengers

  The land step's replay asks which paths a ticket's own commits changed. For a
  merge, `own-commit-changed-paths` answers with the two-tree diff against the
  first parent - everything the second parent brought in, whoever wrote it. So
  a routine `git merge main` whose subject names the ticket being worked on
  credits that ticket with every other ticket's content the sync carried.

  The asymmetry is on the record. `sibling-own-line-changes` already skips merge
  commits, because "a merge authors no lines of its own". The delivered-side
  path set does not, and `ancestry-commits`' own note says so plainly: the
  detector "under-included in exactly the place the path set over-includes".
  Detection was widened to compensate; the over-inclusion was left.

  It came due on 2026-09-03. A QA sync merge named BL-1309 in its subject and
  swept BL-1296's bounce history and BL-1328's bookkeeping into BL-1309's own
  paths, so the replay refused a land with no genuine entanglement in it. And
  the ruling the human gave that same day - refuse every entangled tip, making
  the tip-pure replay the everyday path - means this now costs on every land
  rather than occasionally.

  Background:
    Given a ticket's branch carries a sync merge of main

  # BL-1374 a-sync-merge-is-not-credited-with-its-passengers-01
  Scenario: a sync merge's passengers are not the ticket's own paths
    Given the sync merge's subject names the ticket
    And the sync carried another ticket's unlanded file
    When the replay computes the ticket's own paths
    Then that other ticket's file is not among them

  # BL-1374 a-sync-merge-is-not-credited-with-its-passengers-02
  Scenario: the ticket's own work still replays
    Given the ticket's own commits changed a file
    When the replay computes the ticket's own paths
    Then that file is among them

  # BL-1374 a-sync-merge-is-not-credited-with-its-passengers-03
  Scenario: a genuine entanglement is still refused
    Given the ticket's own commits changed a file shared with an unlanded sibling
    When the land step decides
    Then the land is refused naming that sibling

  # BL-1374 a-sync-merge-is-not-credited-with-its-passengers-04
  Scenario: detection still reaches a passenger's ticket
    Given the sync carried another ticket's unlanded file
    When the land step decides
    Then that other ticket is still reported as unlanded
