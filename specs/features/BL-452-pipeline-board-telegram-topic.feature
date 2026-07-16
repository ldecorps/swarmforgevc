Feature: A live pipeline-board grid in a dedicated Telegram topic shows where each ticket is

  # BL-452 (feature, human/Operator directive relayed 2026-07-16, PRIORITY - jumps the queue on
  # promote): a lowkey kanban board in a DEDICATED standing Telegram topic - a small monospace grid
  # with active BL tickets on the Y axis and pipeline roles on the X axis, a single mark (X) at each
  # ticket's current stage. Glanceable, "a little grid", REALTIME (reflects a stage change within a
  # tick), READ-ONLY. Lives INSIDE the front-desk bot (no separate service); rides the existing
  # concierge event tick + telegramClient (the createForumTopic + edit-in-place pattern the topic-icon
  # sync already uses). Sibling of the Operator / Recert (BL-450) / Approvals (BL-434) standing topics.
  #
  # DATA-SOURCE RESOLUTION (the intake's named "one real design decision", settled with the human via
  # AskUserQuestion 2026-07-16 after the specifier verified the code): the Operator asked for the bridge
  # /pipeline state and NOT the handoff "hop-log". Verified: /pipeline (readPipelineStages, swarmState.ts)
  # reports only each ROLE as busy/idle - it carries NO per-ticket data, so it cannot render a ticket-by-
  # role grid as-is; and the only existing per-ticket->stage source (findLiveHolder / the /holistic
  # `assignments` computation) is derived from handoff holding-windows (the hop-log family) AND walks git
  # history (too heavy for a frequent tick). CHOSEN (human): ENRICH the pipeline state so each role stage
  # carries its CURRENT in-process held ticket id(s) - a cheap current-STATE read (parseHandoffTask on the
  # role's in_process handoff; batch roles may hold several), NOT the stale hop HISTORY the Operator
  # rightly rejected, and NOT the expensive /holistic git-walk. Read the backlog folders (active/paused +
  # human_approval) for the parked / awaiting-approval status columns so every active ticket lands in
  # exactly one cell. This honors "use the pipeline state", stays realtime-cheap on the concierge tick.
  #
  # ANTI-STORM (engineering editForumTopic 429 rule / memory icon-backfill-vs-stale-tick): the board is
  # ONE message edited in place in ONE topic - a single-message edit, not a per-topic fan-out - so it does
  # not trigger the first-tick mass-edit storm. Keep it EDGE-TRIGGERED anyway: only re-render+edit when the
  # rendered grid TEXT changes (durable last-rendered marker, the posture recert-notify-state.json /
  # standingIconSeenIds already model); never edit on an unchanged tick.
  #
  # Scope (verify the LIVE path at build time before naming files):
  #   - Enrich readPipelineStages / PipelineStage (extension/src/swarm/swarmState.ts) and the /pipeline
  #     state (extension/src/bridge/bridgeState.ts) to carry each role's current in_process held ticket
  #     id(s). Cheap read; no git-history walk.
  #   - A PURE, testable board renderer: (active-ticket rows) x (role columns in PIPELINE.md order:
  #     specifier, coder, cleaner, architect, hardender, documenter, QA, coordinator + parked +
  #     awaiting-approval status columns) -> monospace grid text (Telegram code block, ~width fits a phone).
  #   - Post/edit the board into a standing "Pipeline Board" topic from the concierge tick
  #     (extension/src/concierge/conciergeTick.ts), created once alongside the Operator topic
  #     (telegram-front-desk-bot.ts ensureOperatorTopic / standingTopicTargets, BL-418), edit-in-place,
  #     edge-triggered on rendered-text change.
  #   - READ-ONLY / side-effect-free: pure render + post; nothing in the swarm depends on the board.

  # BL-452 pipeline-board-01
  Scenario: Each active ticket is a row marked only at its current stage
    Given active tickets are at various pipeline stages
    When the pipeline board is rendered
    Then each active ticket is a row in the board
    And each ticket's row has a single mark in the column for its current stage
    And a role holding no ticket shows no mark in that ticket's row

  # BL-452 pipeline-board-02
  Scenario Outline: A ticket is marked in exactly the column for its current state
    Given ticket "<id>" is "<state>"
    When the pipeline board is rendered
    Then ticket "<id>" is marked only in the "<column>" column

    Examples:
      | id     | state             | column            |
      | BL-387 | held by the coder | coder             |
      | BL-413 | held by QA        | QA                |
      | BL-436 | parked            | parked            |
      | BL-449 | awaiting approval | awaiting-approval |

  # BL-452 pipeline-board-03
  Scenario: The board is posted once to the Pipeline Board topic, then edited in place on a stage change
    Given the board has already been posted in the Pipeline Board topic
    When a ticket moves to the next stage and the board is rendered again
    Then the existing board message is edited in place to show the ticket's new stage
    And no new board message is posted

  # BL-452 pipeline-board-04
  Scenario: The board is not re-edited when no ticket's stage has changed
    Given the board has been posted and no ticket's stage has changed
    When the concierge tick runs again
    Then the board message is not edited

  # BL-452 pipeline-board-05
  Scenario: Rendering and posting the board modifies no swarm state
    Given active tickets are at various pipeline stages
    When the pipeline board is rendered and posted
    Then no ticket, handoff, or backlog state is modified by the board
