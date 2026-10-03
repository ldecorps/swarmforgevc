Feature: every operator_runtime.bb test fixture sandboxes the libs it load-files

  # BL-671: operator_runtime.bb load-files llm_cost_ledger_lib.bb, but 9 of
  # the 10 test_operator_runtime_*.sh fixtures build their sandbox by
  # explicitly cp-ing operator_runtime.bb alone — the ledger lib was added
  # after those nine were written, so every one of them breaks at require
  # time. Fix (coder's call): a shared fixture helper that copies
  # operator_runtime.bb together with every lib it load-files, so the next
  # added lib breaks one place instead of nine.
  #
  # Scenario 01 ("every test_operator_runtime_*.sh fixture passes
  # end-to-end") was retired on 2026-10-03 (specifier hotfix, stamp-off
  # BL-1908). It ran all sixteen shell fixtures inside one acceptance step.
  # On this host that takes about 25 minutes, and three fixtures (the tick,
  # disk-space and BL-653 tests) run past its 120 s spawn limit, so it was
  # red while every fixture passed. That also breaks the per-mutant ceiling
  # (BL-1541). Each fixture is its own standing shell-lane row, which is
  # where the end-to-end pass is proven. Scenario 02 keeps the contract
  # this feature exists for: one derived copy list, used by every fixture.

  # BL-671 next-added-load-file-breaks-one-place-02
  Scenario: a new lib load-filed by operator_runtime.bb breaks one fixture location, not nine
    Given operator_runtime.bb load-files a new lib not yet in any fixture's sandbox copy list
    When the fixtures' shared sandbox-copy helper is updated for the new lib
    Then every test_operator_runtime_*.sh fixture picks up the new lib without a per-fixture edit
