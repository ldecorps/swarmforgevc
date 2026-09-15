Feature: BL-1584 a new property test with a sampled reach floor is refused at send

  A property test that draws a case space a few times and afterwards
  asserts every arm was reached carries a seed-miss probability on every
  run, and goes red in QA's lane with nothing wrong in the code. Seven
  such files were minted as high-severity unowned reds in ten days, each
  fixed the same way: iterate the cells with runsPerCell and assert the
  floor through assertReachFloor. This gate runs where every parcel
  crosses, the git_handoff send, and refuses a parcel that ADDS a
  property test whose reach floor is sampled over a low draw budget. It
  never refuses a file that already existed, so the sweep of the
  existing files is never blocked by it. One classifier decides the
  refusal, the warning and the census CLI's rows.

  Background:
    Given a fixture repository carrying the frozen classifier corpus under specs/pipeline/fixtures/bl1584
    And a role holding a received parcel commit in its in_process mailbox, ready to hand off

  # BL-1584 a-new-property-test-with-a-sampled-reach-floor-is-refused-at-send-01
  Scenario Outline: what a property test the parcel adds asserts and how it draws decides the send
    Given the parcel's own commit adds a property test file shaped like the corpus file <corpus file>
    When the role sends the git_handoff
    Then the send is <outcome>

    Examples:
      | corpus file                                | outcome |
      | bl1327DescentLadderInvariants              | refused |
      | bl1342CrashloopStampInvariants             | refused |
      | bl1384LocalSeatTopicForwardedInvariants    | refused |
      | cursorSeatDriver                           | refused |
      | bl687WithinEpicLiveItems                   | allowed |
      | bl1003BusyVerdictParity                    | allowed |
      | bl946EpicIconPoolInvariants                | allowed |
      | bl1078UncertifiedCursorRefused             | allowed |
      | bl1529ScriptSenderAuditOutcomesInvariant   | allowed |
      | bl1281ReachFloorConstructionInvariants     | allowed |
      | bl1113CursorHotfixStampOff                 | allowed |
      | bl1304DryRunSpawnsNothing                  | allowed |
      | pilotSafeDefects                           | allowed |

  # BL-1584 a-new-property-test-with-a-sampled-reach-floor-is-refused-at-send-02
  Scenario: the refusal names the file, the assertion that matched, the draw budget and the remedy
    Given the parcel's own commit adds a property test file shaped like the corpus file bl1327DescentLadderInvariants
    When the role sends the git_handoff
    Then the send is refused
    And the refusal names the added property test file
    And the refusal quotes the reach-floor assertion it matched
    And the refusal states the draw budget 3
    And the refusal names runsPerCell and assertReachFloor as the remedy

  # BL-1584 a-new-property-test-with-a-sampled-reach-floor-is-refused-at-send-03
  Scenario Outline: an added file whose floor the gate cannot call sampled-low warns and sends
    Given the parcel's own commit adds a property test file shaped like the corpus file <corpus file>
    When the role sends the git_handoff
    Then the send is allowed
    And a sampled reach floor warning names that property test file

    Examples:
      | corpus file                    |
      | bl946EpicIconPoolInvariants    |
      | bl1078UncertifiedCursorRefused |
      | bl1003BusyVerdictParity        |

  # BL-1584 a-new-property-test-with-a-sampled-reach-floor-is-refused-at-send-04
  Scenario: a file that existed at the received commit is never refused, whatever its shape
    Given the received parcel commit already carries a property test file shaped like the corpus file bl1327DescentLadderInvariants
    And the parcel's own commit modifies that file without constructing its floor
    When the role sends the git_handoff
    Then the send is allowed
    And a sampled reach floor warning names that property test file

  # BL-1584 a-new-property-test-with-a-sampled-reach-floor-is-refused-at-send-05
  Scenario: the gate warns and sends when it cannot read the facts it needs
    Given the parcel's own commit adds a property test file shaped like the corpus file bl1327DescentLadderInvariants
    And the received parcel commit recorded in the in_process mailbox cannot be read
    When the role sends the git_handoff
    Then the send is allowed
    And a warning names the ticket whose received commit could not be read

  # BL-1584 a-new-property-test-with-a-sampled-reach-floor-is-refused-at-send-06
  Scenario Outline: the census CLI classifies the frozen corpus with the same classifier the gate uses
    When the census CLI runs over a tree holding exactly the thirteen corpus files
    Then it prints thirteen rows and a summary
    And the row for <corpus file> reads <verdict> with budget <budget>

    Examples:
      | corpus file                                | verdict      | budget     |
      | bl1327DescentLadderInvariants              | sampled-low  | 3          |
      | bl1342CrashloopStampInvariants             | sampled-low  | 2          |
      | bl1384LocalSeatTopicForwardedInvariants    | sampled-low  | 30         |
      | cursorSeatDriver                           | sampled-low  | unresolved |
      | bl687WithinEpicLiveItems                   | sampled-high | 400        |
      | bl946EpicIconPoolInvariants                | sampled-high | 300        |
      | bl1078UncertifiedCursorRefused             | no-draw      | none       |
      | bl1003BusyVerdictParity                    | no-draw      | none       |
      | bl1529ScriptSenderAuditOutcomesInvariant   | constructed  | unresolved |
      | bl1281ReachFloorConstructionInvariants     | constructed  | 1          |
      | bl1113CursorHotfixStampOff                 | no-floor     | unresolved |
      | bl1304DryRunSpawnsNothing                  | no-floor     | 12         |
      | pilotSafeDefects                           | no-floor     | 80         |
