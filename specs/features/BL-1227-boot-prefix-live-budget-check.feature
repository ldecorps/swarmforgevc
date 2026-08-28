Feature: The boot prefix budget is enforced by a check that measures the live repository
  # BL-1227: fourth boot-prefix overrun — 47648 chars against the 44000-char
  # budget, 3648 over. The three prior overruns (BL-618, BL-858, BL-883) were
  # each fixed by moving prose to reference/, and each regressed, because no
  # check can observe growth: BL-858's live scenario was deliberately PINNED to
  # BL-883's fix commit "so it stays green regardless of later growth", and
  # every remaining test measures a synthetic tree through an injected root.
  # No git hook and no CI workflow invokes the gate. So this slice buys the
  # headroom AND leaves behind a check that measures the real repository and is
  # capable of going red — the two halves are inseparable, since a live check
  # cannot land green until the trim lands with it.
  # Neither the 51200 cap nor the 44000 budget value changes.

  Background:
    Given the stable boot prefix is composed through prompt-engine-lib's own composer

  # BL-1227 boot-prefix-live-budget-01
  Scenario: the trim brings the real repository back under budget
    Given the repository at the BL-1227 fix commit
    When the stable prefix is composed from the real repository tree
    Then the stable prefix length is at most 44000 characters
    And the budget gate exits 0

  # BL-1227 boot-prefix-live-budget-02
  Scenario: the fix lands with real headroom, so the next amendment does not immediately breach
    Given the repository at the BL-1227 fix commit
    When the stable prefix is composed from the real repository tree
    Then the stable prefix length is at most 42000 characters

  # BL-1227 boot-prefix-live-budget-03
  Scenario Outline: the live check is non-vacuous — it fails on a tree over budget
    Given a constitution tree whose composed prefix is <chars> characters
    When the live budget check runs against that tree
    Then the check exits <exit_code>
    And a failing report states the measured size and the 44000 budget

    Examples:
      | chars | exit_code |
      | 43999 | 0         |
      | 44001 | 1         |
      | 47648 | 1         |

  # BL-1227 boot-prefix-live-budget-04
  Scenario: no normative rule text is lost by the trim
    Given a passage removed from a boot-inlined article by the BL-1227 fix commit
    When the reference directory is searched for that passage
    Then the passage appears verbatim in exactly one file under the reference directory
    And the slim article retains a pointer naming that file

  # BL-1227 boot-prefix-live-budget-05
  Scenario: the live check runs without anyone remembering to invoke it
    Given the BL-1227 fix commit
    When the standing verification entry point runs
    Then the live budget check against the real repository is among the checks it runs
    And an over-budget real repository makes that entry point report failure
