# mutation-stamp: sha256=2002927447147117c1b0565fa5a4610d2452a220919940437642b6a99b1947ec
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-16T20:41:38.131728414Z","feature_name":"The pipeline board shows a wider slug, an updated-at footer bumped only on content change, and reposts at the bottom when its content changes","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-462-pipeline-board-wider-slug-updated-at-repost.feature","background_hash":"7df86acdb51ee5925e90ea4c73c2644b6839428dacf7661e5ab79d642e8bd126","implementation_hash":"unknown","scenarios":[{"index":3,"name":"The board reposts at the bottom and bumps its footer only when its content changes","scenario_hash":"b322b0f273e694c8589d0c5252b6d2631597f465f5b5f04ebb6eab7738e7fc70","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-07-16T20:41:38.131728414Z"}]}
# acceptance-mutation-manifest-end

Feature: The pipeline board shows a wider slug, an updated-at footer bumped only on content change, and reposts at the bottom when its content changes

  # BL-462 (feature, human-requested via the Operator front desk, relayed 2026-07-16 from two
  # Telegram intakes by ldecorps — INTAKE-operator-question-1784222028953 and -1784222592328):
  # three further refinements to the live BL-452/BL-455 pipeline board (the monospace kanban grid
  # posted in the dedicated Pipeline Board Telegram topic). Human's answers to the specifier's
  # clarifying questions (2026-07-16):
  #   1. SHOW MORE of each ticket's description — "longer slug, same line": widen the existing SLUG
  #      column so more of the title fits on the ticket's own grid row (do NOT add a second line or
  #      drop the aligned grid).
  #   2. An "updated at MMM DD HH:MM" FOOTER on the board — but "don't refresh the board every minute
  #      or every tick; when new data is updated on the board, then update the timestamp": the footer
  #      time is bumped ONLY when the board's DATA CONTENT changes, never on wall-clock alone.
  #   3. The board must be the LATEST message in the topic — "only on content change": when the
  #      content changes, REPOST the board at the bottom (delete the old board message, post a fresh
  #      one) instead of editing it in place; when content is unchanged, leave the existing message
  #      where it is (no repost).
  #
  # Scope (live paths verified 2026-07-16 — grep-confirm again at build):
  #   - extension/src/concierge/pipelineBoard.ts (pure renderer): widen PIPELINE_BOARD_SLUG_MAX_LENGTH
  #     from 24 to a wider phone-fitting bound; add an "updated at" footer line to renderPipelineBoard,
  #     fed a formatted label derived from an INJECTED instant (never a bare new Date()/Date.now() in
  #     the renderer). The footer label formatter is a pure function of an injected epoch-ms.
  #   - extension/src/concierge/pipelineBoardSync.ts: STOP delegating to syncEditInPlaceMessage. The
  #     board now keys its change-gate on a CONTENT SIGNATURE (the rendered grid + parked list, i.e.
  #     everything EXCEPT the footer timestamp) and, on a content change, DELETES the old board message
  #     and POSTS a fresh one at the bottom; on no change it does nothing. State carries topicId,
  #     messageId, the content signature, and the last-change instant/label.
  #   - extension/src/notify/telegramClient.ts + the board adapters in
  #     extension/src/concierge/conciergeTick.ts: add a deleteMessage(chatId, messageId) wrapper (Bot
  #     API deleteMessage) and wire it as a board adapter; thread the injected clock into
  #     syncBoardIfWired so the last-change instant is deterministic and testable.
  #
  # DO NOT change extension/src/concierge/editInPlaceMessageSync.ts's behavior: it is SHARED with
  # extension/src/concierge/approvalsRosterSync.ts, which must keep editing its roster message IN
  # PLACE. Only the board moves to repost-at-bottom. Do not "DRY" the roster into the board's new
  # repost path.
  #
  # INHERITED from BL-452/BL-455 and unchanged: READ-ONLY / side-effect-free (nothing in the swarm
  # depends on the board); ONE board message in ONE topic; EDGE-TRIGGERED on the content signature
  # (never repost on an unchanged tick — anti-storm / rate-limit rule; memory
  # backfill-vs-stale-tick-icon-revert). Content signature + ordering stay deterministic so the
  # edge-trigger comparison is stable tick over tick.

  Background:
    Given a pipeline board rendered from the active tickets, the parked list, and an injected clock

  # BL-462 pipeline-board-refine-01 RETIRED (BL-505, 2026-07-17): superseded
  # by BL-465, then narrowed again by BL-505 - the grid's SLUG column has
  # shown a short kebab slug (never a truncated title) since BL-465, so this
  # scenario's own premise (a long title fills the grid slug via the widened
  # PIPELINE_BOARD_SLUG_MAX_LENGTH bound) was already false; it kept passing
  # only by fixture coincidence (its all-"a" title has no word boundary, so
  # its kebab slug and its truncated-title slug happen to be byte-identical).
  # The grid's own kebab-slug behaviour is covered directly by BL-465's
  # board-round2-01 scenario (now asserting BL-505's 2-word cap). Retired per
  # the superseded-scenario rule (retire, don't reword) rather than rewritten
  # to duplicate that scenario's own contract.

  # BL-462 pipeline-board-refine-02 RETIRED (BL-475, 2026-07-17): superseded by
  # BL-465 - the grid's SLUG column no longer shows a truncated title at all
  # (it shows a short 2-3 word kebab slug instead; the wider-truncated-title
  # behaviour this scenario asserted moved to the below-grid lists, now
  # covered by BL-465's own board-round2-01b scenario). Retired per the
  # superseded-scenario rule (retire, don't reword) rather than rewritten to
  # duplicate BL-465's own contract.

  # BL-462 pipeline-board-refine-03
  Scenario: The board carries an updated-at footer showing the last content-change time
    Given the board content changes at a known instant
    When the pipeline board is rendered
    Then the board ends with an "updated at" footer showing that instant as month, day, hour and minute

  # BL-462 pipeline-board-refine-04
  Scenario Outline: The board reposts at the bottom and bumps its footer only when its content changes
    Given a board already posted in the topic
    And the board content "<content>" since it was last posted
    When the board sync runs at a later instant
    Then the board is "<repost>"
    And the footer time is "<footer_time>"

    Examples:
      | content   | repost                          | footer_time |
      | changed   | reposted at the bottom          | bumped      |
      | unchanged | left in place                   | unchanged   |

  # BL-462 pipeline-board-refine-05
  Scenario: The first board post has nothing to delete; a later content change deletes the old message before reposting
    Given no board message has been posted yet
    When the board sync runs and posts the board
    Then no prior board message is deleted
    When the board content later changes and the board sync runs again
    Then the previously posted board message is deleted
    And a new board message is posted so the board is the latest message in the topic

  # BL-462 pipeline-board-refine-06
  Scenario: An unchanged board keeps the same footer time even as the clock advances
    Given a board whose content is unchanged across two ticks
    And the injected clock advances between the ticks
    When the board sync runs on the second tick
    Then the board is not reposted
    And the footer time still shows the instant of the last content change

  # BL-462 pipeline-board-refine-07
  Scenario: Rendering and syncing the board modifies no swarm state
    Given active tickets span several stages and a board already posted
    When the board is rendered and synced
    Then no ticket, handoff, or backlog state is modified by the board
