Feature: one seat is driven by structured session events instead of pane text

  BL-1081: pane text is the control channel for every seat, and two expensive
  incident families exist only because of it. Idleness is inferred from a
  frozen pane, which a truncated tail, a ghost suggestion or a lying
  `pane_current_command` each defeat in a different way. A permission moment
  arrives as an interactive menu, which blocks the agent until a human notices;
  the babysitter carries a dedicated CRIT check for exactly that.

  Agent Client Protocol makes both facts rather than inferences: `session/prompt`
  returns a stop reason, and `session/request_permission` is a structured
  message. Gemini CLI, Qwen Code, Mistral Vibe and Copilot CLI speak it
  natively. This slice hosts ONE such seat behind a thin ACP host that lives in
  the role's own tmux pane, and lets the deterministic layer consume those
  events.

  It is a spike, and it is falsifiable. If idle detection cannot be taken from
  a stop reason, or a permission moment cannot be handled without the menu
  block, the spike concludes "reject for our control model" — a valid and cheap
  outcome, not a failure to be worked around.

  The pane is not replaced. The host renders the transcript into it, so human
  observability and the babysitter's pane checks survive; this is the middle
  path, not a control-model rewrite. Likewise the provider table gains a
  dimension rather than forking into an ACP table and a non-ACP one.

  # BL-1081 acp-host-in-a-pane-drives-one-seat-01
  Scenario: a turn ending is read as a fact, not inferred from the pane
    Given an ACP-hosted seat whose agent has returned a stop reason
    When the deterministic layer decides whether that seat is idle
    Then the decision is taken from that stop reason
    And no pane text is read to reach it

  # BL-1081 acp-host-in-a-pane-drives-one-seat-02
  Scenario: a permission moment arrives structured rather than as a menu
    Given an ACP-hosted seat whose agent raises a permission request
    When the deterministic layer handles that moment
    Then it is handled from the structured request
    And the interactive-menu block check does not fire for that seat

  # BL-1081 acp-host-in-a-pane-drives-one-seat-03
  Scenario: the pane keeps a human-readable transcript of the turn
    Given an ACP-hosted seat that has run a turn
    When its pane is captured
    Then the turn is readable there as a transcript
    And the babysitter still returns a pane verdict for that seat

  # BL-1081 acp-host-in-a-pane-drives-one-seat-04
  Scenario: the hosted seat hands work on through the shared helpers
    Given an ACP-hosted seat that has finished its stage work
    When it hands the parcel on
    Then it goes through the shared handoff helper every other agent uses
    And no ACP-specific delivery path reaches the mailbox

  # BL-1081 acp-host-in-a-pane-drives-one-seat-05
  Scenario: the provider table gains a dimension rather than forking
    Given the agent-runtime provider table
    When the ACP dimension is read for each agent it knows
    Then every existing entry still resolves the wake style it resolved before
    And the ACP dimension is a field on that same table
