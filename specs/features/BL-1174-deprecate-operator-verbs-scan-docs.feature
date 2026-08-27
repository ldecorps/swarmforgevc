Feature: deprecate operator verbs scan and retire stale rules with docs

  # BL-1174 (epic BL-1172): /deprecate soft verbs, ranked scan, one retirement
  # per run, docs/deprecated/ stubs linked from docs/index.md.

  Background:
    Given the shared operator verb backend from BL-698
    And the deprecator freshness check from BL-1173

  # BL-1174 deprecate-dry-ranks-01
  Scenario: deprecate dry ranks stale items without mutating
    Given at least one stale-rule signal exists in the tree
    When the operator runs deprecate dry
    Then a ranked list is printed
    And no files under backlog or docs are changed

  # BL-1174 deprecate-retires-one-02
  Scenario: deprecate retires the top ranked item and moves docs
    Given a dead conf flag with no readers ranks first
    When the operator confirms deprecate
    Then that flag is retired
    And a stub is written under docs/deprecated
    And docs/index.md links the stub from a Deprecated section

  # BL-1174 ambiguous-asks-human-03
  Scenario: ambiguous candidates ask the human instead of deleting
    Given the top ranked item is ambiguous between stale and valid
    When the operator runs deprecate
    Then a human ask is surfaced
    And no behaviour is deleted

  # BL-1174 oversized-refuses-04
  Scenario: an oversized retirement refuses with a reason
    Given the top ranked retirement exceeds the one-item size envelope
    When the operator runs deprecate
    Then the verb refuses with a reason
    And nothing is retired

  # BL-1174 weak-seat-refuses-05
  Scenario: deprecate refuses on an easy or weak seat
    Given the executing seat is easy-tier or otherwise weak at multi-document reasoning
    When the operator runs deprecate or deprecate dry
    Then the verb refuses naming needs hard-tier multi-document reasoner
    And no scan mutation or retirement occurs
