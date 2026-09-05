# mutation-stamp: sha256=a134800767750fce8f31b988dd1d334b39dda811b4180429ba250bdc4b38095d
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T22:25:59.871531282Z","feature_name":"BL-1436 The pricing table prices every model the swarm runs","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1436-the-pricing-table-prices-every-model-the-swarm-runs.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":1,"name":"claude-fable-5-1 is priced at its published rate for each token category","scenario_hash":"5505c242ca417f9bd87d2a90f81b7026882d1d41b0c84a177d727447cbe4eae1","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-09-05T22:25:59.871531282Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1436 The pricing table prices every model the swarm runs

  BL-627 corrected the pricing table and added a fail-loud invariant: every
  Anthropic Claude model the swarm roster references (swarmforge.conf, the
  packs, the launch settings) has a PRICING_TABLE entry, and a model absent
  from the table is costed at nothing rather than guessed. On 2026-09-04 the
  full-forge pack's specifier seat was corrected from claude-fable-5 to
  claude-fable-5-1, the model it actually runs; the table has no such entry,
  so the coverage test has been red since and every turn of that seat has
  been costed at nothing in the ledger and the briefing. The standing-red
  register attributed the red to BL-1212, which cites this test file only as
  an example; BL-1212 has landed and the row reads unowned.

  This feature is that the table carries claude-fable-5-1 at its published
  rates with the source recorded beside them, that the coverage check passes
  on the parcel's own tree, that the display-name map names the model, and
  that the register row leaves in the same land that turns the test green.
  Scenario 01 and 04 read the parcel's own tree, a read-only live-tree read
  justified because the roster and the register at this commit are the
  contract.

  # BL-1436 the-roster-is-covered-01
  Scenario: every model the swarm roster references has a pricing entry
    When the pricing coverage check runs over the parcel's own roster sources
    Then it reports every referenced Claude model as priced

  # BL-1436 the-entry-prices-at-the-published-rates-02
  Scenario Outline: claude-fable-5-1 is priced at its published rate for each token category
    Given a usage of one million <category> tokens on claude-fable-5-1 and nothing else
    When the cost is estimated
    Then it is <usd> dollars

    Examples:
      | category       | usd   |
      | input          | 10.00 |
      | output         | 50.00 |
      | cache-read     | 0.25  |

  # BL-1436 the-entry-names-its-source-03
  Scenario: the entry records where its rates came from
    When the claude-fable-5-1 entry in the pricing table is read
    Then a comment beside it names the published pricing source and the date it was read

  # BL-1436 the-display-name-and-the-register-follow-04
  Scenario: the display-name map names the model and the register row is gone
    When the display-name map and backlog/standing-reds.tsv are read at the parcel commit
    Then claude-fable-5-1 renders as Fable 5.1
    And no register row names pricingTable.test.js
