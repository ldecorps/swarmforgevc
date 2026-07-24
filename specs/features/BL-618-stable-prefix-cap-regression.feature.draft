Feature: Stable prefix returns under the boot cap

  # BL-618: prompt_engine_test_runner.bb's gate "stable prefix under 50KB
  # after article splits (< 51200 chars)" FAILS on main: 53408 chars.
  # Reported by the architect 2026-07-24. The fix is the established BL-433
  # mechanism: move elaboration prose from boot-inlined articles into
  # swarmforge/constitution/articles/reference/ files (read on demand, never
  # inlined), keeping the slim articles' rules and one-line pointers intact.
  # The cap itself is deliberate (boot tokens are paid on every agent spawn)
  # and is NOT to be raised.

  # BL-618 gate-green-01
  Scenario: the prompt engine test runner passes on the fix commit
    Given the repository at the fix commit
    When the prompt engine test runner executes
    Then the stable prefix length is under 51200 characters
    And the runner reports ALL PASS

  # BL-618 moved-text-preserved-02
  Scenario: every passage moved out of a boot article survives verbatim in a reference file
    Given the set of passages this fix removed from boot-inlined articles
    When each removed passage is searched for under "swarmforge/constitution/articles/reference/"
    Then each removed passage is found verbatim in exactly one reference file

  # BL-618 slim-pointer-retained-03
  Scenario: a slimmed boot article still points at the reference file that absorbed its prose
    Given a boot article that lost a passage to a reference file in this fix
    When that slim article is read
    Then it retains a pointer naming the reference file that absorbed the passage

  # BL-618 no-rule-dropped-04
  Scenario: no normative rule is deleted outright by the slimming
    Given the diff of this fix across the constitution tree
    When the removed lines are compared against the added lines
    Then every removed normative rule sentence appears in a reference file or remains in its slim article
