Feature: BL-2110 A Markdown link in a rendered doc is a link

  markdownToOperatorDocsHtml (operatorDocsCore.ts) renders the operator
  docs pages (BL-1166) and the Article drafts page (BL-2101). Its inline
  pass handles only code and bold, so an inline link shows as literal
  bracket-and-paren text. The Art Director's brief of 2026-10-10 found it
  on the first line of every episode draft. An absolute http or https link
  now renders as a link. Any other target renders as its text alone,
  because a relative docs link has nowhere to resolve inside the page.

  # BL-2110 markdown-link-01
  Scenario Outline: an absolute web link renders as a link to that address
    When the paragraph "<markdown>" is rendered
    Then the output contains a link to "<url>" reading "<text>"
    And the output does not contain "]("

    Examples:
      | markdown                                       | url                          | text            |
      | [Listen - Magma](https://magma.example/track)  | https://magma.example/track  | Listen - Magma  |
      | See [the notes](http://notes.example/a) today  | http://notes.example/a       | the notes       |

  # BL-2110 markdown-link-02
  Scenario: two links in a row both render, neither swallowing the other
    When the paragraph "[Listen - Trio](https://a.example/1) [Last.fm](https://b.example/2)" is rendered
    Then the output contains a link to "https://a.example/1" reading "Listen - Trio"
    And the output contains a link to "https://b.example/2" reading "Last.fm"

  # BL-2110 markdown-link-03
  Scenario Outline: a link that is not absolute http or https renders as its text with no link
    When the paragraph "<markdown>" is rendered
    Then the output contains "<text>"
    And the output contains no link
    And the output does not contain "]("

    Examples:
      | markdown                                  | text         |
      | Read [the how-to](../how-to/run.md) first | the how-to   |
      | [click me](javascript:alert)              | click me     |

  # BL-2110 markdown-link-04
  Scenario: an ampersand and angle brackets in link text and address are escaped
    When the paragraph "[Tom & <Jerry>](https://x.example/?a=1&b=2)" is rendered
    Then the output contains a link to "https://x.example/?a=1&amp;b=2" reading "Tom &amp; &lt;Jerry&gt;"

  # BL-2110 markdown-link-05
  Scenario: bold and code beside a link render as before
    When the paragraph "**Now** run `npm test` then [read](https://r.example/)" is rendered
    Then the output contains "<strong>Now</strong>"
    And the output contains "<code>npm test</code>"
    And the output contains a link to "https://r.example/" reading "read"
