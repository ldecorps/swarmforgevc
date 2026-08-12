Feature: Boot stable prefix returns under the 44000 budget with enforced landing headroom

  # BL-883: third boot-prefix overrun — 46947 chars against the 44000-char
  # budget three days after BL-858 landed at 43757. Unlike BL-618/BL-858
  # this is a budget bust, not a cap bust: the bb runner is green at 51200
  # but BL-858's live headroom-budget-02 scenario is red on main. The fix is
  # the established BL-433 split mechanism (move elaboration prose into
  # articles/reference/, keep slim rules + a pointer). New in this parcel:
  # the landing target (42000) has acceptance teeth of its own, pinned to
  # the fix commit so it stays green regardless of later growth — both prior
  # trims landed within 300 chars of the only asserted number and re-busted.
  # Neither the 51200 cap nor the 44000 budget value changes.

  Background:
    Given the repository at the BL-883 fix commit

  # BL-883 budget-restored-01
  Scenario: the boot prefix is back at or under the budget and the runner is green
    When the prompt engine test runner executes
    Then the stable prefix length is at most 44000 characters
    And the runner reports ALL PASS

  # BL-883 landing-headroom-02
  Scenario: the fix lands with real headroom under the budget, pinned to its own commit
    When the stable prefix is composed from the BL-883 fix commit's tree through the real composer
    Then the composed prefix length at that commit is at most 42000 characters

  # BL-883 moved-text-preserved-03
  Scenario: every passage this parcel removed from a boot article survives verbatim in a reference file
    Given the set of passages the BL-883 parcel removed from boot-inlined articles
    When each removed passage is searched for under "swarmforge/constitution/articles/reference/"
    Then each removed passage is found verbatim in exactly one reference file

  # BL-883 slim-pointer-retained-04
  Scenario: a slimmed boot article still points at the reference file that absorbed its prose
    Given a boot article that lost a passage to a reference file in the BL-883 parcel
    When that slim article is read
    Then it retains a pointer naming the reference file that absorbed the passage

  # BL-883 no-rule-dropped-05
  Scenario: no normative rule is deleted outright by the slimming
    Given the diff of the BL-883 parcel across the constitution tree
    When the removed lines are compared against the added lines
    Then every removed normative rule sentence appears in a reference file or remains in its slim article

  # BL-883 cap-value-unchanged-06
  Scenario: headroom is not bought by weakening the gate
    When the cap enforced by the prompt engine test runner is read
    Then the enforced cap is still 51200 characters
