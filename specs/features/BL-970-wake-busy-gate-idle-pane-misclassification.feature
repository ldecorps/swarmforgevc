Feature: BL-970 wake busy-gate classifies from live turn state, not whole-pane word matching

  The chase/deliver/nudge/rotate busy gate decides whether a role pane may be
  woken. All four gate predicates funnel into one pure classifier over a
  captured pane-text snapshot. The classifier must key on the pane's live
  turn indicators (the busy footer / live status frame), never on marker
  words found anywhere in the visible scrollback: stale tool chrome from
  finished or backgrounded work, and busy-marker phrases quoted inside
  transcript text, persist at an idle prompt and must not read as busy.
  A role misread as busy is never woken, so nothing ever scrolls the marker
  away — the misclassification is self-sustaining.

  Trap-resistance note: verbatim busy-marker strings live ONLY in the fixture
  files under specs/features/fixtures/BL-970/, never in this feature file or
  the ticket YAML — a pane merely displaying those strings (an agent reading
  this spec aloud, a quoted log line) is exactly the false-busy input under
  test.

  Background:
    Given the pane snapshot fixtures directory "specs/features/fixtures/BL-970"

  # BL-970 wake-busy-gate-idle-pane-misclassification-01
  Scenario Outline: classification matches the pane's actual turn state
    Given the pane snapshot fixture "<fixture>"
    When the busy gate classifies the snapshot
    Then the busy classification is <busy>

    Examples:
      | fixture                                    | busy  |
      | idle-bg-shell-running-chrome.txt           | false |
      | idle-quoted-busy-marker.txt                | false |
      | idle-real-qa-4-shells.txt                  | false |
      | midturn-esc-footer.txt                     | true  |
      | midturn-unlisted-verb-real-capture.txt     | true  |
      | midturn-unlisted-verb-no-counter.txt       | true  |
      | empty-capture.txt                          | false |

  # The empty-capture.txt row is the failed/unreadable-capture contract: the
  # capture path degrades to empty text on error, and an unreadable pane must
  # never block a wake.
