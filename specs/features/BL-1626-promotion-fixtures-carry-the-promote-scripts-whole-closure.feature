Feature: BL-1626 Promotion fixtures carry the promote script's whole closure

  Three landed promotion features have been red on main for weeks with no
  owner. Two of their step handlers copy the promote chain's Babashka
  libraries into a fixture from a hand-maintained list, and the chain's
  load-file closure grew twice since the lists were written; the third
  copies promote_and_route_next.sh into its fixture, where the freshness
  gate that script gained cannot find the compiled deprecate-check CLI and
  holds fail-closed. BL-1538 already made the closure derivable at build
  time. This feature is that each fixture derives the closure it copies,
  that the freshness gate finds its CLI inside the bl1100 fixture and
  answers on its own, and that every handler copying the promote chain is
  counted and derives its closure. The three features' own green runs are
  QA's e2e steps, not scenarios (BL-1541).

  # BL-1626 promotion-fixtures-carry-the-whole-closure-01
  Scenario Outline: a promotion fixture carries every library the promote chain load-files
    Given the fixture scripts directory that the <handler> step handler builds
    When its contents are diffed against the derived load-file closure of promotion_gates_cli.bb
    Then no library is missing from the fixture

    Examples:
      | handler                                                     |
      | bl803PromoteRouteSedPortabilitySteps.js                     |
      | bl1028PromotionMustNotBypassARefusedIntegrityCommitSteps.js |

  # BL-1626 promotion-fixtures-carry-the-whole-closure-02
  Scenario: the freshness gate finds its CLI inside the bl1100 fixture and answers allow
    Given the fixture root that the bl1100 step handler builds, holding one paused fixture ticket
    When the copied promote_and_route_next.sh resolves the deprecate-check CLI from that root
    Then it finds the repository's compiled CLI
    And the gate's answer for the fixture ticket is allow

  # BL-1626 promotion-fixtures-carry-the-whole-closure-03
  # Census pin (BL-1445): the population is every handler that copies the promote chain, counted.
  Scenario: every step handler that copies the promote chain derives its closure
    When the step handlers that copy promote_and_route_next.sh or promotion_gates_cli.bb into a fixture are listed
    Then at least 3 handlers are listed and the count is reported
    And every listed handler builds its fixture through a closure-deriving helper
