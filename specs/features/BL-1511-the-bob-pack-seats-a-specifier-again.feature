Feature: BL-1511 The BoB mono-router pack seats a specifier again

  bob-multi-provider-mono-router.conf removed its specifier window when
  every seat moved to aider on b.ai, because the claude agent cannot
  reach b.ai at all; the header still says "nothing can rotate here".
  The operator's scoring pull shows claude-fable-5-1 and glm-5.3-flash
  tied at 1.0 on specifier, with the deeper evidence behind Claude, and
  asked for the seat to be reinstated - the exact model is the operator's
  ruling on the ticket. This feature is that the pack has a specifier
  again, the staffing gate accepts every window line, and the header
  tells the truth about the launch.

  # BL-1511 bob-pack-seats-a-specifier-01
  Scenario: the pack declares a specifier window on the ruled model
    When the pack is parsed
    Then it has exactly one specifier window line
    And that line pins the agent and model the ticket's human ruling names

  # BL-1511 bob-pack-seats-a-specifier-02
  Scenario: the staffing gate passes every window line of the pack without the override hatch
    Given PACK_STAFFING_SKIP_GATE is unset
    When the pack staffing gate runs on the pack
    Then every window line reads pass

  # BL-1511 bob-pack-seats-a-specifier-03
  Scenario: the header's role table and launch line match the window lines
    When the pack header is read
    Then its role table names a specifier row with the same agent and model as the window line
    And it no longer says the specifier is absent or that nothing can rotate there
    And its launch line names only environment the gate still requires
