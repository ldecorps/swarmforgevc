Feature: BL-1792 a headless briefing's recent git activity renders one list item per commit

  The headless closing-ceremony composer (banked_briefing_lib.bb,
  compose-banked-briefing, BL-308/BL-1641) writes docs/briefings/<day>.md
  with each git log line as a bare line of text: no "- " marker, no blank
  line between entries. The send path renders that file with
  markdown-to-html-lib, which follows CommonMark's soft-line-break rule and
  folds consecutive bare lines into ONE paragraph. Rendered at mint, the
  2026-09-27 briefing's "Recent git activity" is a single <p> of 17,316
  characters with zero <li> elements, and "Backlog counts" folds the same
  way ("active: 7 paused: 118 done: 903"). The Art Director's brief
  (docs/design/briefs/2026-09-28-headless-briefing-wall-of-text.md,
  art-director tip 3d8d7563c7): "each git log line in a headless-composed
  briefing appears as its own visually separated line in the sent email".
  This feature is that every line-per-entry section the composer emits is
  a Markdown list, one "- " item per entry, so the existing list renderer
  (BL-1419) yields one <li> per commit and per count. The fallback lines
  for an empty section and the ordinary coordinator/documenter-composed
  briefing are unchanged.

  Background:
    Given the headless composer is given a day key and backlog counts of 7 active, 118 paused and 903 done

  # BL-1792 each-git-line-is-a-list-item-01
  Scenario: every git activity line the composer is given becomes its own Markdown list item
    Given the composer is given 30 git activity lines each opening with a distinct 10-hex commit id
    When the headless briefing is composed
    Then the "Recent git activity" section holds exactly 30 lines and each begins with "- " followed by its commit id
    And no bare non-blank line follows the "Recent git activity" heading before the next heading

  # BL-1792 rendered-email-has-one-li-per-commit-02
  Scenario: the rendered HTML part separates every commit
    Given the composer is given 30 git activity lines each opening with a distinct 10-hex commit id
    When the headless briefing is composed and rendered through the send pipeline
    Then the HTML part holds exactly 30 <li> elements for the git activity section, one per commit id
    And no <p> element of the HTML part contains two of those commit ids

  # BL-1792 backlog-counts-are-list-items-03
  Scenario: the backlog counts render as three separate items
    Given the composer is given no git activity lines and no daemon health lines
    When the headless briefing is composed and rendered through the send pipeline
    Then the HTML part holds an <li> for each of "active: 7", "paused: 118" and "done: 903"
    And no <p> element of the HTML part contains two of those counts

  # BL-1792 empty-section-fallback-unchanged-04
  Scenario Outline: an empty section still prints its fallback line
    Given the composer is given no git activity lines and no daemon health lines
    When the headless briefing is composed
    Then the "<section>" section contains the fallback line "<fallback>"

    Examples:
      | section             | fallback                             |
      | Recent git activity | No recent git activity.              |
      | Daemon health       | Daemon health unavailable this run.  |
