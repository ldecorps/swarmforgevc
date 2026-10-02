Feature: BL-1903 A bounce reverts nothing, and the bounce-revert scope guard retires

  Before BL-1871 a bounced parcel stayed in every long-lived branch it had
  been merged into, so the bouncing role reverted what it had wrongly
  added (BL-490), and check_bounce_revert_scope.sh (BL-1471) checked that
  each revert removed only the bounced ticket's paths. On parcel lines a
  bounced parcel is left behind at the next take-up, and no role makes a
  bounce revert. The guard now checks commits nobody writes, and it named
  the wrong ticket on 2026-10-01 (an ancestor match on a stale record,
  BL-1835's row in the merge-collateral-scope ledger). It retires from
  the commit guard chain, and BL-1471's feature retires with it.

  # BL-1903 the-chain-runs-no-revert-scope-check-01
  Scenario: the commit guard chain no longer runs a bounce-revert scope check
    When the guards that run_commit_guards.sh and the commit-msg hook run are listed
    Then neither lists check_bounce_revert_scope.sh
    And run_commit_guards.sh still runs its other 11 guards

  # BL-1903 the-guard-and-its-contract-are-gone-02
  Scenario: the guard script and BL-1471's feature are retired, not reworded
    When the repository's tracked paths are listed
    Then swarmforge/scripts/check_bounce_revert_scope.sh is not among them
    And specs/features holds no file whose name starts with BL-1471-
