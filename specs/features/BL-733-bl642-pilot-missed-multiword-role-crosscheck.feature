Feature: pattern tickets must cross-check against the producer's output space before pilot land
  BL-733 (companion BL-732). BL-642's chrome regex was validated against its
  own repro pane text and a handful of negatives, but never against
  swarmforge.sh display_name_for_role() — the actual generator of the strings
  the pattern must match everywhere. Multi-word and @-seat role names missed.
  BL-727 made the pilot execute acceptance before land; this slice adds the
  producer/pattern discipline: enumerable producer output spaces must be
  cross-checked exhaustively, not sampled from one observed instance. Source:
  BL-723 review of BL-642.

  Background:
    Given the pilot acceptance gate is the only landing path
    And a ticket adds a regex or pattern meant to recognize output from a named producer elsewhere in the codebase

  # BL-733 repro-only-pattern-coverage-refuses-land-01
  Scenario: a pattern ticket refuses land when acceptance only exercised the observed repro strings
    Given a pattern ticket whose acceptance was run only against the original repro and a small negative sample
    And the acceptance did not cross-check the pattern against the producer's enumerable output space
    When the pilot attempts to land the ticket
    Then the land is refused
    And the refusal names missing producer output-space crosscheck as insufficient

  # BL-733 producer-output-space-crosscheck-runs-02
  Scenario: pattern acceptance cross-checks every value the producer can emit
    Given a producer with an enumerable output space such as display_name_for_role for configured roles
    When the pilot runs the ticket's acceptance contract before land
    Then the acceptance pipeline exercises the pattern against that producer's full output space
    And the run records producer crosscheck metadata on the receipt path

  # BL-733 exhaustive-crosscheck-green-lands-03
  Scenario: a green exhaustive producer crosscheck lands with receipt metadata
    Given a pattern ticket whose acceptance passes after exhaustive producer crosscheck
    When the pilot lands the ticket
    Then the ticket yaml is moved to backlog/done/
    And the acceptance receipt records the producer output-space crosscheck was performed

  # BL-733 incomplete-crosscheck-refuses-inert-04
  Scenario: an incomplete producer crosscheck refuses land without side effects
    Given a pattern ticket whose producer crosscheck fails or leaves uncovered producible values
    When the pilot attempts to land the ticket
    Then the land is refused
    And the ticket yaml still sits in backlog/active/
    And no acceptance receipt is written
