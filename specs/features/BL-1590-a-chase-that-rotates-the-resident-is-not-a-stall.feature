Feature: BL-1590 A chase that rotates the resident is not a stall

  On a rotation-router pack a parcel delivered to a dormant role waits until
  the resident is rotated there. When the forwarding seat did not rotate
  itself to the recipient (a QA merge-up broadcast to five roles, a reverse
  hop copy, a coordinator note, a resident busy elsewhere), the chase sweep
  makes that rotation: chase-poke-and-notify!'s :rotate mode respawns the
  resident as the chased role. The chase row written by apply-inbox-item-
  action! does not say which poke advanced it, leanLedgerComposeStall folds
  every chase row into a stall, and the closing-ceremony packet turns the
  router's own transport into a "chase pattern" hypothesis and a raise dial
  citing stalls for the chased role. This feature is that a chase row names
  its poke (wake or rotate), that a row naming a rotation composes no stall,
  and that a row naming a wake or naming no poke composes exactly the stall
  it composes today.

  Background:
    Given a chase sweep whose inbox item has reached the chased rung of the chase ladder

  # BL-1590 chase-rotate-not-a-stall-01
  Scenario Outline: the chase row names the poke that advanced it
    Given the send-wake-up adapter reports <result>
    When the sweep applies the chased action
    Then the chaser telemetry gains one row of type chase for the role carrying the item's chase count
    And that row's poke field <poke>

    Examples:
      | result                         | poke          |
      | a performed rotate             | reads rotate  |
      | an attempted wake              | reads wake    |
      | a plain boolean true           | is absent     |

  # BL-1590 chase-rotate-not-a-stall-02
  Scenario Outline: the lifecycle ledger composes a stall only for a chase that was not a rotation
    Given a chaser telemetry file holding one chase row <shape> inside a role's ticket window
    When the lifecycle ledger composes that ticket's stall events
    Then <count> stall events with eventType chase are composed for that role
    And the unrecognised chaser telemetry type report is empty

    Examples:
      | shape              | count |
      | naming poke rotate | 0     |
      | naming poke wake   | 1     |
      | naming no poke     | 1     |

  # BL-1590 chase-rotate-not-a-stall-03
  # Census pin (BL-1445): the test prints one PASS line per case, so the
  # new case is named literally; a runner that silently lost it would still
  # report all passed.
  Scenario: the daemon's own chase adapter reports a performed rotate as a rotate
    When the chase departing-mid-parcel gate shell test runs against the real handoffd.bb with a fake tmux
    Then it reports every check passed
    And its passing checks include case 08, a performed chase rotate whose chase row names poke rotate
