Feature: BL-1784 An unowned verification-debt category throttles intake

  BL-1782's ledger reports a category unowned when its outstanding hand
  verifications reach the threshold and no open ticket declares it. A
  report nobody has to act on is the prompt-only rule the human asked to go
  past. Human, 2026-09-26, verbatim: "this principle should be a core
  responsibility of the lean coordinator. Or is there a way to enforce this
  rule even harder on the swarm engine?" This feature makes an unowned
  category an Article 3.5 health signal, the same way BL-1429 made an
  unowned standing red one. The emitter reads the ledger through BL-1782's
  reader and recommends a cap of 1 while any category is unowned. It keeps
  the lowest recommendation across every signal, logs each change with the
  category that caused it, and withdraws the recommendation once every
  category is owned, settled (BL-1783) or back under its threshold. Cap 1
  is a soft stop, never a freeze. The specifier clears it by minting a
  ticket that declares the category, or by a recorded waiver. Every
  scenario runs against a fixture root under a temporary directory, never
  the live checkout.

  Background:
    Given a fixture root with a throttle recommendation store, an empty standing-red register, no rework signal and a verification-debt ledger at the default threshold of 3

  # BL-1784 an-unowned-category-recommends-a-cap-of-one-01
  Scenario Outline: only an unowned category recommends a cap
    Given category "land-path-ownership" is <state>
    When the throttle recommendation is emitted
    Then the recommended cap is <cap>
    And the recorded reason names <signal>

    Examples:
      | state                                        | cap  | signal                                            |
      | at its threshold with no open owner          | 1    | the verification-debt category land-path-ownership |
      | at its threshold and owned by an open ticket | none | no verification-debt signal                       |
      | at its threshold and discharged              | none | no verification-debt signal                       |
      | at its threshold and waived                  | none | no verification-debt signal                       |
      | one row under its threshold                  | none | no verification-debt signal                       |

  # BL-1784 the-lowest-recommendation-wins-02
  Scenario Outline: the verification-debt signal never raises another signal's cap
    Given <other signal>
    And category "land-path-ownership" is at its threshold with no open owner
    When the throttle recommendation is emitted
    Then the recommended cap is <cap>

    Examples:
      | other signal                                  | cap |
      | a rework diagnosis that recommends a cap of 0 | 0   |
      | an unowned standing red                       | 1   |

  # BL-1784 minting-an-owner-withdraws-the-recommendation-03
  Scenario: minting an owner withdraws the recommendation and logs the change
    Given a prior recommendation of 1 caused by the verification-debt category "land-path-ownership"
    And a ticket in backlog/paused now declares "verification_category: land-path-ownership"
    When the throttle recommendation is emitted
    Then the recommendation is withdrawn
    And the change from 1 to none is logged naming the verification-debt category "land-path-ownership" as cleared

  # BL-1784 the-effective-depth-the-coordinator-reads-folds-the-signal-04
  Scenario: the effective backlog depth the coordinator reads folds the signal in
    Given swarmforge.conf sets active_backlog_max_depth to 3
    And category "land-path-ownership" is at its threshold with no open owner
    When the effective backlog depth is resolved
    Then it prints 1
