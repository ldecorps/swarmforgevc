Feature: BL-1003 the extension host's busy verdict matches the swarm's

  A mid-turn pane is classified twice, in two languages, in two processes.
  BL-970 replaced the swarm-side definition with a two-layer one — a
  STRUCTURAL live-status-frame match, consulted only within the snapshot's
  TAIL WINDOW — and landed. The extension host was not in that parcel and
  still substring-matches one marker anywhere in the capture, so it is
  missing both layers, and each missing layer produces one direction of
  disagreement: no tail window gives a false BUSY on a pane merely quoting
  the marker in scrollback, and no structural match gives a false IDLE on a
  pane genuinely mid-turn whose frame does not carry that substring.

  The false-idle direction is the dangerous one. The extension host's busy
  verdict is the precheck that refuses to type a forced respawn into a pane
  that is provably mid-turn — the check BL-137 exists to justify. On a real
  captured pane ten minutes into a turn it currently answers "not busy".

  Trap-resistance note: verbatim busy-marker strings live ONLY in the fixture
  files under specs/features/fixtures/BL-970/, never in this feature file or
  the ticket YAML — a pane merely displaying those strings is exactly the
  false-busy input under test.

  Background:
    Given the pane snapshot fixtures directory "specs/features/fixtures/BL-970"

  # BL-1003 the-extension-host-busy-verdict-matches-the-swarms-01
  Scenario Outline: the extension host's verdict matches the swarm's for every shared capture
    Given the pane snapshot fixture "<fixture>"
    When the extension host classifies the snapshot
    Then the extension host busy verdict is <busy>
    And the swarm's classifier returns the same verdict for that snapshot

    Examples:
      | fixture                                | busy  |
      | empty-capture.txt                      | false |
      | idle-bg-shell-running-chrome.txt       | false |
      | idle-quoted-busy-marker.txt            | false |
      | idle-real-qa-4-shells.txt              | false |
      | midturn-esc-footer.txt                 | true  |
      | midturn-unlisted-verb-no-counter.txt   | true  |
      | midturn-unlisted-verb-real-capture.txt | true  |

  # BL-1003 the-extension-host-busy-verdict-matches-the-swarms-02
  Scenario Outline: the forced-respawn precheck follows the corrected verdict
    Given the pane snapshot fixture "<fixture>"
    When a forced respawn precheck runs against that snapshot
    Then the respawn is refused as busy: <refused>

    Examples:
      | fixture                                | refused |
      | midturn-unlisted-verb-real-capture.txt | true    |
      | idle-quoted-busy-marker.txt            | false   |

  # BL-1003 the-extension-host-busy-verdict-matches-the-swarms-03
  Scenario Outline: agent-CLI presence detection is unchanged by the busy verdict
    Given the pane snapshot fixture "<fixture>"
    When the extension host is asked whether an agent CLI is present
    Then the agent CLI presence answer is <present>

    Examples:
      | fixture                                | present |
      | idle-real-qa-4-shells.txt              | true    |
      | midturn-unlisted-verb-real-capture.txt | true    |
      | empty-capture.txt                      | false   |
