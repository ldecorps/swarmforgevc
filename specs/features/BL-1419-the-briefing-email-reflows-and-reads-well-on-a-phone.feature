Feature: BL-1419 The daily briefing email reflows its text and reads well on a phone

  The briefing markdown is written hard-wrapped at ~74 columns. BL-393
  renders it to HTML for the email through markdown_to_html_lib.bb, whose
  renderer turns EVERY non-blank line into its own <p>: a five-line
  paragraph becomes five one-line paragraphs, a "- " list item and its
  indented continuation lines become separate paragraphs starting with "-"
  and two spaces, a "> " blockquote becomes eight paragraphs starting with
  ">", and a **bold** span that wraps never closes. On a phone the email
  reads as ragged fragments. The human, 2026-09-05: "first job: reflow text
  in daily breigin email. also make it better looking overall."

  This feature is that consecutive lines reflow into their block, that the
  markdown the briefings actually use (paragraphs, "- " lists with
  continuation, "> " quotes, backtick code, bold spanning a wrap, headings,
  tables) renders as the matching HTML block, and that the HTML part is laid
  out for a phone mail client: a single column of bounded width, a font
  stack, spacing and heading styles carried inline on the elements, a
  header naming the briefing and its date, and the diagrams section under
  its own heading. The plain-text part stays the markdown, unchanged.

  Background:
    Given a briefing markdown written hard-wrapped at 74 columns

  # BL-1419 wrapped-lines-reflow-into-one-block-01
  Scenario Outline: consecutive wrapped lines render as one block element
    Given the briefing contains <construct> spanning several wrapped lines
    When the briefing email payload is built
    Then the HTML part renders it as one <element> whose text joins the lines with single spaces

    Examples:
      | construct                                   | element      |
      | a paragraph                                 | p            |
      | a blockquote of "> " lines                  | blockquote   |
      | a bold span that wraps across two lines     | strong       |

  # BL-1419 lists-with-continuation-are-real-lists-02
  Scenario: a "- " list whose items wrap onto indented continuation lines renders as one list
    Given the briefing contains a list of three "- " items each with indented continuation lines
    When the briefing email payload is built
    Then the HTML part renders one <ul> with exactly three <li>
    And no <p> or <li> in the HTML part begins with "- ", "> " or two spaces

  # BL-1419 inline-code-and-headings-keep-their-markup-03
  Scenario: backtick spans and headings render as code and heading elements
    Given the briefing contains backtick spans inside a paragraph and ## headings
    When the briefing email payload is built
    Then each backtick span renders as a <code> element and each heading as an <h2>

  # BL-1419 the-html-part-carries-a-phone-layout-04
  Scenario: the HTML part is laid out for a phone mail client with inline styles
    When the briefing email payload is built
    Then the HTML part wraps the body in a single column with a declared maximum width and a font stack
    And every block element carries its spacing and type styles inline
    And a header names the briefing and its date before the first section
    And the diagrams section appears under its own heading after the body

  # BL-1419 the-plain-text-part-is-untouched-05
  Scenario: the plain-text part still carries the markdown unchanged
    When the briefing email payload is built
    Then the plain-text part is byte-identical to the composed markdown

  # BL-1419 the-2026-09-05-briefing-renders-clean-06
  Scenario: the real 2026-09-05 briefing renders with no wrapped fragments
    Given docs/briefings/2026-09-05.md as the briefing
    When the briefing email payload is built
    Then the HTML part has exactly 24 <li>, one <blockquote>, three <h2>
    And no <p> or <li> in the HTML part begins with "- ", "> " or two spaces
