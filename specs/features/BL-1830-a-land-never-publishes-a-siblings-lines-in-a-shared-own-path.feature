Feature: BL-1830 A land never publishes an unlanded sibling's lines inside a file the landing ticket also changed
  The land step's tip-pure replay decides by whole path. A path the landing
  ticket changed is written from the reviewed tip, whole, so when an
  unlanded sibling also added lines to that same file on the tip, those
  lines reach main with the landing ticket while the sibling's other files
  are left out. BL-1801's land (e1cb2615de) did this with two of BL-1821's
  rows in the suite manifest, naming test files main did not have. BL-1717
  closed the same gap for paths the landing ticket never touched. A shared
  own path is now rebuilt from origin/main plus the landing ticket's own
  commits' changes, and a change that cannot apply without the sibling's
  lines escalates by name.

  Background:
    Given a fixture origin/main and a reviewed tip for landing ticket BL-9001
    And unlanded sibling BL-9002 added one row to the shared file "swarmforge/scripts/test/suite-manifest.tsv" on the same tip

  # BL-1830 shared-own-path-carries-only-own-lines-01
  Scenario: the replayed shared file carries the landing ticket's row and not the sibling's
    Given BL-9001 added its own row to that file
    When the land step replays BL-9001
    Then the replayed file carries BL-9001's row
    And it carries no row BL-9002 added

  # BL-1830 own-change-needing-sibling-lines-escalates-02
  Scenario: an own change that only applies on top of the sibling's lines escalates by name
    Given BL-9001 edited the row BL-9002 added
    When the land step replays BL-9001
    Then the land escalates naming the file and BL-9002

  # BL-1830 unshared-own-path-unchanged-03
  Scenario: an own path no unlanded sibling touched lands byte-identical to the reviewed tip
    Given BL-9001 changed "extension/src/own.ts", which no other ticket touched
    When the land step replays BL-9001
    Then the replayed "extension/src/own.ts" is byte-identical to the reviewed tip
