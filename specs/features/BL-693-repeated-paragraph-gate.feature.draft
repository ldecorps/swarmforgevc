Feature: a markdown doc cannot ship the same prose paragraph twice

  830 KB of one repeated paragraph sat in the project's reference
  specification for 17 days and roughly 25 documenter commits before anything
  objected. Nothing in the repo lints prose.

  This guard rides the suite every parcel already runs and fails when a
  substantial prose line repeats inside one markdown file under docs/.
  Markdown that is supposed to repeat — fences, rules, table separators, list
  markers, diagram glyphs — is short, so the substantiality threshold excludes
  it without any exemption list.

  Background:
    Given the standing docs duplicate-paragraph guard

  # BL-693 doc-dup-gate-01
  Scenario: the real docs tree repeats no substantial paragraph
    Given the scanned tree is the real docs directory after BL-692 landed
    When the guard scans that tree
    Then the guard passes

  # BL-693 doc-dup-gate-02
  Scenario Outline: a repeated prose line fails the guard, and the report names what to fix
    Given a markdown file with one substantial prose line appearing <count> times
    When the guard scans that tree
    Then the guard fails
    And the report names the file, the repeated text, <count> occurrences, and the line numbers
    And removing all but one copy clears the report

    Examples:
      | count |
      | 2     |
      | 286   |

  # BL-693 doc-dup-gate-03
  Scenario Outline: a short repeated line is not a duplicated paragraph
    Given a markdown file repeating only the short structural line <line>
    When the guard scans that tree
    Then the guard passes

    Examples:
      | line               |
      | horizontal rule    |
      | heading            |
      | code fence         |
      | table separator    |
      | list marker        |
      | blockquote marker  |
      | diagram glyph      |

  # BL-693 doc-dup-gate-04
  Scenario: repetition across two files is not a duplicate
    Given two markdown files sharing one substantial prose line
    When the guard scans that tree
    Then the guard passes

  # BL-693 doc-dup-gate-05
  Scenario: every file in the tree is checked, not just the first
    Given a clean markdown file and a markdown file with a repeated substantial prose line
    When the guard scans that tree
    Then the guard fails
    And the report names the second file

  # BL-693 doc-dup-gate-06
  Scenario: the guard reaches green without an exemption list
    Given the scanned tree is the real docs directory after BL-692 landed
    When the guard is inspected for per-file and per-paragraph allowlists
    Then it declares none
