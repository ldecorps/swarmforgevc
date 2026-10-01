Feature: BL-1856 The merge-drop guard counts a repeated line before calling it lost

  BL-1576's guard refuses a forward whose merge lost lines one side alone
  had changed. It decides by text: a "+" line in diff(side, merge) is a
  resurrection when that side removed a line with the same text, and a "-"
  line is a drop when that side added one. Specification.MD's changelog
  ends every entry in the same separator, "Prior entry —", about 400 times.
  On 2026-10-01 the hardener's side of a merge removed one separator while
  deduplicating an entry, and the documenter's side added two new entries,
  each ending in a separator. The guard read the documenter's two new
  separators as resurrections of the one the hardener removed and refused
  BL-1845's send. No resolution could keep both sides' work and pass. The
  guard now compares counts: a line text is a finding only when the merge
  holds more or fewer copies of it than the side's own count plus the other
  side's net change predicts. A copy the other side added or removed
  elsewhere no longer counts against this side, and putting back the one
  copy this side removed is still found.

  Background:
    Given a fixture repository with a changelog whose every entry ends in the line "Prior entry —"
    And the received side removed one of those separator lines in a hunk the sender's side never touched
    And the sender's side added two new entries, each ending in "Prior entry —"

  # BL-1856 the-guard-counts-repeated-lines-01
  Scenario Outline: what the merge did with the repeated separator decides the findings
    Given the sender merged the received commit and resolved the changelog by <resolution>
    When the merge-drop guard reads the forward
    Then it reports <received> lost lines on the received side and <sender> on the sender side

    Examples:
      | resolution                                                       | received | sender |
      | keeping both sides' hunks                                        | 0        | 0      |
      | keeping both sides' hunks and putting the removed separator back | 1        | 0      |
      | keeping both sides' hunks but dropping one new entry's separator | 0        | 1      |
