Feature: BL-1621 The bl1297 property tests derive their budget through the lane's helper

  QA's BL-1605 pass on 2026-09-17 (parcel 9583f2177c, the full property
  lane through qa-gather.js) timed out invariant 3 of
  extension/test/bl1297MergeOwnPathsInvariants.property.test.js at the
  lane's flat 20-second testTimeout. The file is touched by nothing on
  that branch and is green alone in about 15 seconds, invariant 3 alone
  in 8 to 9 seconds, with BL-1564's one-bb-process batches and its
  21/18/18 reach maps intact; its three tests simply pass no per-test
  budget at all, so the lane's raw ceiling is theirs and it does not
  move with contention - the bl1304 shape BL-1606 fixed the day before.
  This feature is that every test in the file derives its budget from
  the 20000 ms base it sits on today through the property lane's budget
  helper, that the file stays green alone with the same reach maps, and
  that the evidence records the full-lane text and the remedy. The
  full-lane green run and the register rows leaving are QA's e2e steps,
  not scenarios, so the feature fits the per-mutant ceiling (BL-1541).

  # BL-1621 bl1297-budget-through-the-lane-helper-01
  Scenario: every invariant test in the file derives its budget from the lane's base through the helper
    When the source of extension/test/bl1297MergeOwnPathsInvariants.property.test.js is read
    Then it declares exactly 3 tests
    And no test in it passes a bare numeric literal as its per-test timeout
    And every test in it receives a per-test budget derived from 20000 ms through the property lane's budget helper

  # BL-1621 bl1297-budget-through-the-lane-helper-02
  Scenario: the file is green alone on the tree as it stands with its reach maps unchanged
    When extension/test/bl1297MergeOwnPathsInvariants.property.test.js runs alone under the properties config
    Then every test in it passes
    And its three BL-1564 reach maps report 21, 18 and 18 cases

  # BL-1621 bl1297-budget-through-the-lane-helper-03
  Scenario: the evidence records the full-lane failure and the change that removed it
    When the parcel's evidence for extension/test/bl1297MergeOwnPathsInvariants.property.test.js is read
    Then it records the failing test name and the timeout message verbatim from a full property-lane run and the change that removed it
