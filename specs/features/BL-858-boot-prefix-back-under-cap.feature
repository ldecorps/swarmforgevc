Feature: Boot stable prefix returns under the cap with real headroom

  # BL-858: the boot stable prefix measured by
  # swarmforge/scripts/test/prompt_engine_test_runner.bb is 65138 chars
  # against the 51200-char cap - the SECOND bust after BL-618 trimmed it to
  # ~50909 and left only 291 chars of headroom, which 15 amendment commits
  # consumed in 15 days. The fix is the established BL-433 split mechanism,
  # scaled up: move elaboration prose out of the boot-inlined articles into
  # swarmforge/constitution/articles/reference/ (read on demand, never
  # inlined), keeping each slim article's normative rules and a pointer to
  # the file that absorbed the prose. The cap is NOT raised, and headroom is
  # bought by moving prose - never by weakening the gate.

  Background:
    Given the repository at the parcel's fix commit

  # BL-858 under-cap-01
  Scenario: the boot prefix is back under the hard cap
    When the prompt engine test runner executes
    Then the stable prefix length is under 51200 characters
    And the runner reports ALL PASS

  # BL-858 headroom-budget-02
  Scenario: the boot prefix lands inside the headroom budget, not merely under the cap
    When the prompt engine test runner executes
    Then the stable prefix length is at most 44000 characters

  # BL-858 moved-text-preserved-03
  Scenario: every passage this parcel removed from a boot article survives verbatim in a reference file
    Given the set of passages this parcel removed from boot-inlined articles
    When each removed passage is searched for under "swarmforge/constitution/articles/reference/"
    Then each removed passage is found verbatim in exactly one reference file

  # BL-858 slim-pointer-retained-04
  Scenario: a slimmed boot article still points at the reference file that absorbed its prose
    Given a boot article that lost a passage to a reference file in this parcel
    When that slim article is read
    Then it retains a pointer naming the reference file that absorbed the passage

  # BL-858 no-rule-dropped-05
  Scenario: no normative rule is deleted outright by the slimming
    Given the diff of this parcel across the constitution tree
    When the removed lines are compared against the added lines
    Then every removed normative rule sentence appears in a reference file or remains in its slim article

  # BL-858 cap-value-unchanged-06
  Scenario: headroom is not bought by weakening the gate
    When the cap enforced by the prompt engine test runner is read
    Then the enforced cap is still 51200 characters
