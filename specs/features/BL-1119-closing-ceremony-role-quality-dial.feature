Feature: BL-1119 closing ceremony recommends per-role quality dial
  After a shift, the closing-ceremony packet recommends a quality dial
  per pipeline role from existing lean ledger signals (BL-819/820).
  This slice recommends only — it does not rewrite pack conf.
  The dial does not apply to roles whose window model is auto
  (auto / cursor/auto / copilot/auto): those seats stay on provider auto.

  # BL-1119 lean-signal-dial-01
  Scenario Outline: ceremony packet dials quality from lean shift signals
    Given a finished shift whose lean ledger shows <lean_signal> for one pipeline role
    And that role's window model is a concrete non-auto model
    When the closing-ceremony packet is built
    Then that role receives a quality <dial> recommendation
    And <side_effect>

    Examples:
      | lean_signal                                      | dial          | side_effect                                              |
      | elevated bounces or stalls                       | raise         | the recommendation cites the lean ledger fields used     |
      | clean closes without rework                      | lower or hold | pack conf window model and effort lines stay unchanged   |

  # BL-1119 auto-model-exempt-02
  Scenario Outline: auto-model seats are exempt from quality raise or lower
    Given a finished shift whose lean ledger shows elevated bounces or stalls for one pipeline role
    And that role's window model is <auto_model>
    When the closing-ceremony packet is built
    Then that role receives a quality hold or skip recommendation
    And the packet does not recommend changing that role's model or effort

    Examples:
      | auto_model    |
      | auto          |
      | cursor/auto   |
      | copilot/auto  |

  # BL-1119 human-can-refuse-03
  Scenario: the specifier lean pass can refuse or reverse a dial recommendation
    Given a ceremony packet that recommends a quality change for a role
    When the specifier records a lean outcome of no_change for that shift
    Then the recommendation is recorded as refused or held
    And no pack conf rewrite is applied
