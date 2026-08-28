Feature: paneHistory module decrap slice is behavior-preserving and under CRAP threshold

  # BL-428 policy §2 — first module-scoped decrap slice from the standing tracker.
  # Scope: extension/src/panel/paneHistory.ts (+ media/panel.js parity).
  # Target: detectFooterLineCount was CRAP 15.03; all scoped functions must end ≤6.
  # Pure internal refactor — no user-visible commands, settings, or flows.

  Background:
    Given the paneHistory decrap slice targets extension/src/panel/paneHistory.ts

  # BL-428 crap-threshold-01
  Scenario: scoped paneHistory functions report CRAP at or below the project gate
    When a scoped CRAP report runs for paneHistory.ts
    Then detectFooterLineCount reports CRAP at most 6
    And findPromptLineIndex reports CRAP at most 6
    And tryExtendFooterLine reports CRAP at most 6
    And extendFooterEnd reports CRAP at most 6

  # BL-428 behavior-preserved-02
  Scenario: footer detection behavior is unchanged after the refactor
    Given the existing paneHistory unit tests for detectFooterLineCount
    When those tests run against the refactored module
    Then every scenario passes without changing its assertions

  # BL-428 panel-parity-03
  Scenario: TypeScript footer detection stays aligned with media/panel.js
    Given the footerDetectionParity test suite
    When it compares paneHistory.ts against media/panel.js
    Then parity holds for every covered footer-detection case

  # BL-428 history-accumulation-04
  Scenario: pane history accumulation behavior is unchanged
    Given the existing accumulatePaneHistory unit tests
    When those tests run against the refactored module
    Then every scenario passes without changing its assertions

  # BL-428 scroll-behavior-05
  Scenario: footer-aware scroll behavior is unchanged
    Given the footerAwareScroll test suite
    When it exercises scroll logic that depends on footer detection
    Then every scenario passes without changing its assertions

  # Non-behavioral gates (hardener slice):
  #  - 100% coverage on touched functions; no surviving mutants in the slice.
  #  - No production behavior change — existing tests are the contract.
