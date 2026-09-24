Feature: BL-1722 The hotfix ledger's state snapshot never leaves the checkout dirty

  The operator runtime's hotfix-certification sweep derives each ledger
  row's state (pending, stamp-open, awaiting-human, certified) and writes
  it back into backlog/hotfix-ledger.yaml, a tracked file on the shared
  checkout, without committing it. Linking a stamp ticket sets the ticket
  but not the state, so every link and every later state change leaves an
  uncommitted diff. The coordinator met the same one three times on
  2026-09-24. This feature is that the committed ledger carries each row's
  current state and the sweep leaves no uncommitted change behind.

  Background:
    Given a fixture repository whose committed hotfix ledger has a row linked to an open stamp ticket and recorded as pending

  # BL-1722 the-sweep-leaves-the-ledger-committed-and-current-01
  Scenario: after the certification sweep the committed ledger reads stamp-open and the tree is clean
    When the operator runtime's hotfix-certification sweep runs
    Then the ledger at HEAD records that row as stamp-open
    And git status shows no change to backlog/hotfix-ledger.yaml

  # BL-1722 a-sweep-with-nothing-to-change-commits-nothing-02
  Scenario: a second sweep with no state change makes no commit
    Given the certification sweep has already run once
    When the operator runtime's hotfix-certification sweep runs
    Then HEAD is unchanged
