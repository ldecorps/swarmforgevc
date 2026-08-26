# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-16T12:23:53.922376324Z","feature_name":"A live pipeline-board grid in a dedicated Telegram topic shows where each ticket is","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-452-pipeline-board-telegram-topic.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

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

  # Hardener (BL-234 equivalent-mutant note): a soft Gherkin mutation pass over this
  # outline's <id> examples mangles one character of each value (BL-387 -> BLx387,
  # BL-413 -> Bl-413) and both mutants SURVIVE - by design, not a gap. The SAME <id>
  # substitution value drives BOTH the Given step (ticket "<id>" is "<state>") and the
  # Then step (ticket "<id>" is marked only in the "<column>" column), so the step
  # handlers always assert a mutated id round-trips to itself - a self-consistency
  # check that no id mutation could ever fail. renderPipelineBoard (pipelineBoard.ts)
  # treats a ticket id as an opaque passthrough string (row.id.padEnd(idWidth)), never
  # validated against a closed set the way <state>/<column> are (KNOWN_STATES/
  # KNOWN_COLUMNS in bl452PipelineBoardSteps.js, which is exactly why every <state>/
  # <column> mutant in this same outline IS killed). The id-rendering behavior itself
  # (padding, column alignment, widening to the longest id) is already exhaustively
  # covered by pipelineBoard.test.js. No artificial assertion was added to force these
  # 2 to die.
  # BL-455 RECONCILIATION (2026-07-16): parked/awaiting-approval are no longer grid
  # COLUMNS - BL-455 moves them to a below-grid list instead, so this outline dropped
  # its BL-436 ("parked" -> "parked") and BL-449 ("awaiting approval" ->
  # "awaiting-approval") examples entirely (they never reach this outline's <column>
  # Then step now). Where those two states render is now asserted by
  # specs/features/BL-455-pipeline-board-epic-grouping-parked-slug.feature's own
  # pipeline-board-epic-02 outline ("<placement>": "below-grid parked list"). This
  # outline keeps only the two states that are still real grid columns.
  # BL-452 pipeline-board-02
  Scenario Outline: A ticket is marked in exactly the column for its current state
    Given ticket "<id>" is "<state>"
    When the pipeline board is rendered
    Then ticket "<id>" is marked only in the "<column>" column

    Examples:
      | id     | state             | column |
      | BL-387 | held by the coder | coder  |
      | BL-413 | held by QA        | QA     |

  # BL-452 pipeline-board-03/04 RETIRED (2026-07-16, specifier): these two scenarios asserted the
  # ORIGINAL edit-in-place update mechanism (a stage change edits the existing board message in place;
  # an unchanged tick does not re-edit). BL-462 deliberately REPLACED that mechanism with
  # delete-old + post-fresh-at-the-bottom on a content change (pipelineBoardSync.ts), so the
  # edit-in-place premise no longer holds and pipeline-board-03 failed honestly (0 edits, 1 fresh
  # post) rather than being quietly rewritten under the coder's hand (a spec change is the
  # specifier's lane). The repost/no-repost behavior is now the durable contract of
  # specs/features/BL-462-pipeline-board-wider-slug-updated-at-repost.feature —
  # pipeline-board-refine-04 (reposts at the bottom / left in place, per content change),
  # -refine-05 (first post deletes nothing; a later change deletes the old before reposting) and
  # -refine-06 (an unchanged board is not reposted and keeps its footer time). Re-wording these two
  # here would only DUPLICATE that contract (one-scenario-per-behaviour / IR-DRY), so they are
  # retired, not moved. BL-452's remaining scenarios (the grid rows, the stage-column marking, and
  # the no-swarm-state-modification guarantee) are unaffected by the update mechanism and stay.

  # BL-452 pipeline-board-05
  Scenario: Rendering and posting the board modifies no swarm state
    Given active tickets are at various pipeline stages
    When the pipeline board is rendered and posted
    Then no ticket, handoff, or backlog state is modified by the board
