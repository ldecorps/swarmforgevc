Feature: BL-959 APS candidate toolchain equivalence verdict
  The dual-run comparator turns a pinned-toolchain result set and a
  candidate-toolchain result set over the same corpus into a per-entry
  verdict matrix, so a human can decide the swarmforge.lock.json pin bump
  from evidence instead of trust. It fails closed: absence of a result is
  never read as equivalence.

  Background:
    Given a comparison work dir holding a pinned-run result set and a candidate-run result set for the same corpus

  # BL-959 aps-candidate-equivalence-01
  Scenario: identical gate outcomes verdict EQUIVALENT with exit 0
    Given every corpus entry carries the same gate outcome in both result sets
    When the equivalence comparator runs over the work dir
    Then the verdict matrix marks every corpus entry EQUIVALENT
    And the comparator exits 0

  # BL-959 aps-candidate-equivalence-02
  Scenario Outline: a non-equivalent candidate outcome fails closed with a non-zero exit
    Given the candidate result set records <candidate outcome> for the lint gate on exactly one corpus entry
    When the equivalence comparator runs over the work dir
    Then the verdict matrix marks exactly that corpus entry <verdict> naming the lint gate
    And the comparator exits non-zero

    Examples:
      | candidate outcome   | verdict    |
      | a differing outcome | DIVERGENT  |
      | no recorded outcome | INCOMPLETE |
