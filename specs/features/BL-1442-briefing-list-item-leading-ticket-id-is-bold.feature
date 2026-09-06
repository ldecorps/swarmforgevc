Feature: BL-1442 A briefing-email list item that opens with a ticket id renders that id in bold

  The daily briefing's themed groups open with a bold intro sentence and
  then list their tickets as plain "- BL-1309: ..." items. BL-1419 reflows
  those items into real <li> elements, but the ticket id that opens each
  item sits in the same regular weight as the sentence around it, so a
  reader scanning the email on a phone for one ticket has nothing to catch
  the eye. The Art Director's brief
  (docs/design/briefs/2026-09-06-briefing-list-item-scan-weight.md):
  "The leading ticket-ID token in each list item is bolded, matching the
  weight already used for the group-intro sentence."

  This feature is that the ticket ids which open a list item - the item's
  leading label: ids joined by "and", "/", "," or "+", each id optionally
  followed by a parenthesised aside - render as <strong> elements carrying
  font-weight:600 inline; that an id mentioned later in the sentence or
  inside an aside stays regular; that an item not opening with a ticket id
  is untouched; and that the plain-text part and the markdown source stay
  exactly as they were, because the bolding is a render-time effect of the
  HTML part only.

  Background:
    Given a briefing markdown written hard-wrapped at 74 columns

  # BL-1442 leading-ticket-ids-render-bold-01
  Scenario Outline: the ids that open a list item render bold and nothing else does
    Given the briefing contains a list item reading "<item>"
    When the briefing email payload is built
    Then that list item renders exactly <bold> in bold

    Examples:
      | item                                                                                                      | bold             |
      | BL-1309: the one landing step QA cannot skip never asked what the tip carried                             | BL-1309          |
      | BL-1374: a routine named after a ticket credited BL-1385's replay with every passenger                    | BL-1374          |
      | BL-1386 and BL-1387: the reconcile sweep never orphans a merge it started                                 | BL-1386, BL-1387 |
      | BL-1413 (active) is a live operational issue right now                                                    | BL-1413          |
      | BL-1398 (commit-guard fixture) and BL-1401 (BL-632 acceptance fixture) both derive their guard set        | BL-1398, BL-1401 |
      | GH-29: an issue-seeded ticket closes its issue when it lands                                              | GH-29            |
      | **Active** (6): BL-1365 (this session's own ticket)                                                       | Active           |
      | New tickets minted since 2026-09-03 and still open include BL-1410                                        | nothing          |

  # BL-1442 the-bold-is-inline-weight-only-02
  Scenario: the added bold carries its weight inline and adds no colour or style block
    Given the briefing contains a list item reading "BL-1309: the one landing step QA cannot skip"
    When the briefing email payload is built
    Then every <strong> inside an <li> carries font-weight:600 inline and no color
    And the HTML part contains no <style> block

  # BL-1442 the-2026-09-05-briefing-scans-by-id-03
  Scenario: the real 2026-09-05 briefing renders every id-led item bold and every other item untouched
    Given docs/briefings/2026-09-05.md as the briefing
    When the briefing email payload is built
    Then the HTML part still has exactly 24 <li>
    And exactly 19 <li> open with a bold ticket id
    And exactly 23 ticket ids render bold in the whole HTML part, one per id in an item's leading label

  # BL-1442 the-plain-text-part-and-source-are-untouched-04
  Scenario: the bolding is a render-time effect of the HTML part only
    Given docs/briefings/2026-09-05.md as the briefing
    When the briefing email payload is built
    Then the plain-text part is byte-identical to the composed markdown
    And the briefing file on disk is byte-identical to the fixture
