Feature: BL-1717 A landed co-owner never shields an unlanded sibling's lines

  BL-1389 keeps a path an unlanded sibling owns alone out of another
  ticket's land. On 2026-09-24 BL-1687's replay carried BL-1693's
  unlanded lines in a step file BL-1687 never touched. The file had one
  other owner, BL-1685, which had already landed, so the path did not
  count as BL-1693's alone and rode whole, with no report line. The only
  lines it changed on main were BL-1693's. QA's hand diff caught it. This
  feature is that an owner whose lines on a path are already on main does
  not count against excluding that path, and that an unlanded sibling's
  lines never ride unreported.

  BL-1830 takes out this feature's scenario 02 (retired, never reworded -
  BL-1006): it asserted a shared own path rode whole with the unlanded
  sibling named as a passenger, the exact behaviour BL-1830's rebuild fix
  removes. Its one unique assertion, the report naming the rebuilt path,
  is now BL-1830's own scenario 01 And step. Scenario 01 here, about a path
  the landing ticket never touched, is unaffected and unchanged.

  Background:
    Given a fixture origin where landed ticket L and unlanded approved ticket U both changed path P, and landing ticket A changed its own path Q

  # BL-1717 a-landed-co-owner-does-not-keep-the-path-01
  Scenario: A's land leaves out a path whose only lines not on main are U's
    When the land step plans A's land
    Then the built commit's diff against origin/main names Q and not P
    And the report names P as excluded, credited to U
