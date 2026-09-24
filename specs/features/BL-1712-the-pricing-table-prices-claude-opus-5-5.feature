Feature: BL-1712 the pricing table prices claude-opus-5-5

  On 2026-09-24 the full-forge pack's specifier seat moved from
  claude-fable-5-1 to claude-opus-5-5 (db5d1313e4). The pricing table has
  no row for that model, so the coverage invariant BL-627 added is red on
  main - in pricingTable.test.js and in BL-1436's landed feature - and
  every turn of that seat is costed at nothing in the ledger and the
  briefing. This is BL-1436's shape a second time. The table now carries
  claude-opus-5-5 at the rates in the project's Claude API reference with
  the source beside them; a rate that reference does not publish (cache
  creation) stays unset, never derived from a sibling row; the
  display-name map names the model; and both register rows stay owned by
  this ticket in the parcel and are retired by its land (BL-1631) - a
  parcel never edits the register (BL-1663). Scenarios 01 and 04 read the
  parcel's own tree.

  # BL-1712 the-pricing-table-prices-claude-opus-5-5-01
  Scenario: every model the swarm roster references has a pricing entry
    When the pricing coverage check runs over the parcel's own roster sources
    Then it reports every referenced Claude model as priced

  # BL-1712 the-pricing-table-prices-claude-opus-5-5-02
  Scenario Outline: claude-opus-5-5 is priced at its published rate for each token category
    Given a usage of one million <category> tokens on claude-opus-5-5 and nothing else
    When the cost is estimated
    Then it is <usd> dollars

    Examples:
      | category   | usd   |
      | input      | 4.00  |
      | output     | 20.00 |
      | cache-read | 0.20  |

  # BL-1712 the-pricing-table-prices-claude-opus-5-5-03
  Scenario: a cache-creation turn on claude-opus-5-5 is costed as unknown, not guessed
    Given a usage of one million cache-creation tokens on claude-opus-5-5 and nothing else
    When the cost is estimated
    Then the estimate is null

  # BL-1712 the-pricing-table-prices-claude-opus-5-5-register-rows-owned-04
  Scenario: the display-name map names the model and both register rows are owned by BL-1712
    When the display-name map and the standing-red register are read from the parcel's own tree
    Then claude-opus-5-5 displays as "Opus 5.5"
    And the register rows naming pricingTable.test.js and the BL-1436 feature file are both present and each names BL-1712 as its owner
