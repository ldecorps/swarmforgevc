Feature: BL-1511 The BoB mono-router pack seats a specifier again

  bob-multi-provider-mono-router.conf removed its specifier window when
  every seat moved to aider on b.ai, because the claude agent cannot
  reach b.ai at all; the header still says "nothing can rotate here".
  The operator's scoring pull shows claude-fable-5-1 and glm-5.3-flash
  tied at 1.0 on specifier, with the deeper evidence behind Claude, and
  asked for the seat to be reinstated - the exact model is the operator's
  ruling on the ticket. This feature is that the pack has a specifier
  again, that the staffing gate reads the pack's window lines the way the
  launcher does and decides them on steward evidence (passing every line
  when the evidence certifies the seats, refusing the specifier line when
  it does not), and that the header tells the truth about the launch:
  today no compliance scorecard exists for either model, so the hatch
  stays and the PREREQ names the check that clears it.

  # BL-1511 bob-pack-seats-a-specifier-01
  Scenario: the pack declares a specifier window on the ruled model
    When the pack is parsed
    Then it has exactly one specifier window line
    And that line pins the agent and model the ticket's human ruling names

  # BL-1511 bob-pack-seats-a-specifier-02
  Scenario Outline: the staffing gate reads the pack's window lines as the launcher does and decides on steward evidence
    Given a scratch root whose steward registry ranks the pack's worker model on every worker role with each role gate recorded pass and <specifier-evidence>
    And PACK_STAFFING_SKIP_GATE is unset
    When the pack staffing gate runs on the windows-file derived from the pack by the launcher's field rules
    Then the derived windows-file holds exactly 7 window lines, the specifier line among them
    And <verdicts>

    Examples:
      | specifier-evidence                                                          | verdicts                                                                          |
      | ranks the ruled specifier model on specifier with its role gate recorded pass | every window line reads pass                                                      |
      | carries no entry for the ruled specifier model                              | every worker line reads pass and the specifier line refuses not-on-role-matrix   |

  # BL-1511 bob-pack-seats-a-specifier-03
  Scenario: the header's role table and launch line match the window lines and the gate's real verdict
    When the pack header is read
    Then its role table names a specifier row with the same agent and model as the window line
    And it no longer says the specifier is absent or that nothing can rotate there
    And its LAUNCH line carries PACK_STAFFING_SKIP_GATE=1 and its PREREQ names role-gate-not-pass and the compliance battery steward command that clears it
