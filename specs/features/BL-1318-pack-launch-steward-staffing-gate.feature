Feature: BL-1318 pack launch refuses a seat whose model the steward has not cleared for that role

  ModelFactory's assign / cold-apply / failover paths already consult the
  steward's certification gate. Pack `window` lines bypass it entirely: a pack
  may pin any agent, --model and --openai-api-base, and launch staffs the seat
  with no steward consult at all. Worse, the global `certified` flag is not a
  per-role clearance — a model certified on a thin coder scorecard can sit the
  QA seat while its QA-gate is still human-verdict-pending and it appears on no
  QA role-matrix. That happened live on 2026-08-31 and the QA seat idled
  instead of running its gate. This ticket puts the same shape of refusal
  BL-1127 gives the local coder battery in front of EVERY pack window, reading
  steward evidence only — never capturing it at launch time.

  Background:
    Given a steward registry fixture carrying a role matrix and a compliance scorecard per model
    And a pack fixture whose window lines pin an agent and a model for every pipeline role

  # BL-1318 refuses-uncleared-seat-01
  Scenario Outline: launch refuses a seat the steward has not cleared for that role
    Given the pack's QA window resolves to a model that is <standing>
    When the pack is parsed for launch
    Then launch is refused before any seat is staffed
    And the refusal names the role, the resolved provider and model, the failing check "<failing_check>", and the steward command that would clear it
    Examples:
      | standing                                                            | failing_check           |
      | globally certified but absent from the QA role-matrix               | not-on-role-matrix      |
      | ranked on the QA role-matrix with a human-verdict-pending QA-gate   | role-gate-not-pass      |
      | ranked with a passing QA-gate but no longer assignment-eligible     | not-assignment-eligible |

  # BL-1318 unresolvable-seat-fails-closed-02
  Scenario: a window whose provider and model cannot be resolved refuses rather than staffing
    Given the pack's QA window names an agent and model the seat resolver has no mapping for
    When the pack is parsed for launch
    Then launch is refused before any seat is staffed
    And the refusal names the role, quotes the unresolved window line, and reports the failing check "seat-model-unresolved"

  # BL-1318 cleared-seat-staffs-unchanged-03
  Scenario: a seat the steward ranks for its role staffs exactly as before
    Given the pack's QA window resolves to a model that is ranked on the QA role-matrix with a passing QA-gate and still assignment-eligible
    When the pack is parsed for launch
    Then every window staffs
    And the gate records a pass decision naming the role and the resolved provider and model

  # BL-1318 override-staffs-loudly-04
  Scenario: the operator override staffs an uncleared seat and never reads as a pass
    Given the pack's QA window resolves to a model that is globally certified but absent from the QA role-matrix
    And the operator sets the staffing-gate override
    When the pack is parsed for launch
    Then every window staffs
    And a warning names the role, the resolved provider and model, and the failing check
    And the recorded decision is "override" and never "pass"

  # BL-1318 gate-reads-evidence-only-05
  Scenario: the gate reads steward evidence and never writes or captures it
    Given the pack's QA window resolves to a model that is globally certified but absent from the QA role-matrix
    When the pack is parsed for launch
    Then the steward registry, its scorecards and its role matrices are byte-identical to before the parse
    And no compliance battery is run
