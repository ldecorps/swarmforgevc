Feature: The invariant-two pin asks the QA question

  BL-925 invariant 2 says there is ONE shared QA-ancestry predicate. The
  assertion guarding it in the babysitter sweep's own test greps
  `babysitter_check.bb` for the text `merge-base` or `--is-ancestor` and fails
  on any hit, "string arguments included".

  That is broader than the invariant. `merge-base HEAD origin/main` at
  `babysitter_check.bb:817` asks whether local main has diverged from origin -
  a main-sync question, not a QA-ancestry one. The invariant is intact; the
  assertion is over-broad, and it has been red ever since BL-1187 added that
  call.

  This is the same defect BL-1314 already fixed for `handoffd.bb`, where the
  human ruled option 1: scope the assertion to the QA question, leave the
  legitimate helper alone. The sibling assertion never got the same treatment.

  Background:
    Given the babysitter sweep's invariant-two assertion

  # BL-1372 the-invariant-two-pin-asks-the-qa-question-01
  Scenario: a non-QA ancestry call does not fail the invariant
    Given the sweep asks whether local main has diverged from origin
    When the invariant-two assertion runs
    Then the assertion passes

  # BL-1372 the-invariant-two-pin-asks-the-qa-question-02
  Scenario: a second QA-ancestry predicate still fails the invariant
    Given the sweep decides QA ancestry without the shared predicate
    When the invariant-two assertion runs
    Then the assertion fails naming the second predicate

  # BL-1372 the-invariant-two-pin-asks-the-qa-question-03
  Scenario: the shared predicate is still named exactly once
    Given the sweep decides QA ancestry through the shared predicate only
    When the invariant-two assertion runs
    Then the assertion passes
