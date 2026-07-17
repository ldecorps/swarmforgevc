Feature: The pipeline board shows every active ticket at its true current stage exactly once, from an authoritative coordinator-fed source

  # BL-464 (bug, expedite — human via the Operator front desk 2026-07-16,
  # INTAKE-operator-question-1784230241758 + the DEFECT in -1784230021148). The live BL-452/BL-455
  # pipeline board is WRONG about where work is, which the human called out as defeating the board's
  # whole purpose: (a) tickets a role is actively working do not appear at all — he watched the coder
  # on BL-434 and BL-450 while neither showed on the board; (b) a single ticket renders on TWO rows
  # with different stage marks during a transition (he saw BL-460 twice, once under DC and once under
  # QA).
  #
  # ROOT CAUSE (verified in code 2026-07-16): the board's data source is
  # extension/src/swarm/swarmState.ts readInProcessTicketIds, which SCRAPES each role's inbox/in_process
  # handoff files and extracts a ticket id ONLY from a git_handoff's `task:` header. Two failures follow:
  #   - A freshly-PROMOTED ticket is kicked off by a coordinator NOTE to the coder (the promote-via-note
  #     convention), and a note has NO `task:` header — so the coder's active ticket is invisible to the
  #     board until it becomes a downstream git_handoff. That is why BL-434/450 were missing.
  #   - extension/src/concierge/pipelineBoard.ts computePipelineBoard pushes one row per (role, id) with
  #     no cross-role dedupe, so a ticket whose handoff momentarily sits in_process at two roles renders
  #     as two rows.
  #
  # THE FIX (human's chosen approach, Q2 2026-07-16 — "the coordinator, who knows where tickets are,
  # could feed in the details for this grid"): the board's ACTIVE ticket rows must come from an
  # AUTHORITATIVE ticket->stage source that reflects where each active ticket actually is — the same
  # parcel-location knowledge the coordinator already uses to track and unblock work — NOT an
  # in_process scrape. It must cover a ticket held via a coordinator note as well as one held via a
  # git_handoff, and yield EXACTLY ONE stage per ticket.
  #
  # Scope (grep-confirm at build):
  #   - The authoritative source is fed by the coordinator (the component that tracks parcel location):
  #     it PERSISTS each active ticket's current stage to a durable store the concierge tick reads. This
  #     is a NAMED WRITER->READER wiring pair (engineering: a consumer that reads a store needs a real
  #     production writer of that exact store — do not ship the reader over an unfed store). The
  #     coordinator.prompt instruction to persist ticket->stage is a specifier-owned change that lands
  #     with this ticket; the writer helper + the concierge-tick read are the coder's.
  #   - extension/src/concierge/conciergeTick.ts syncBoardIfWired / extension/src/swarm/swarmState.ts:
  #     replace the in_process-scrape data source (readRoleHeldTickets / readInProcessTicketIds) with a
  #     read of the authoritative store; retire or bypass the task-header-only scrape for the grid.
  #   - extension/src/concierge/pipelineBoard.ts computePipelineBoard: guarantee one row per active
  #     ticket at its single current stage (the authoritative source yields one stage, so the renderer
  #     must not re-introduce duplicate rows).
  #   - INHERITED and unchanged: READ-ONLY board (nothing depends on it); edge-triggered on rendered
  #     content; deterministic ordering. Keep the render + the join pure/testable; the Telegram API +
  #     tmux stay the untested boundary.
  #
  # Sequencing: edits pipelineBoard.ts / conciergeTick.ts — the standing-topic/board overlap cluster.
  # Serialize against in-flight BL-462 and any other active conciergeTick.ts/pipelineBoard.ts ticket;
  # build on whatever board scaffolding is on main at build time.

  # BL-464 board-authoritative-stage-01
  Scenario: A ticket the coder works after a note-based promotion appears at the coder stage
    Given a ticket promoted to active and kicked off to the coder by a coordinator note
    And the coder is actively working it
    When the pipeline board is rendered
    Then the ticket appears on the board at the coder's stage

  # BL-464 board-authoritative-stage-02
  Scenario: Each active ticket appears on exactly one row
    Given an active ticket whose handoff is momentarily observable at two roles during a transition
    When the pipeline board is rendered
    Then the ticket appears on exactly one row
    And that row is its single current stage

  # BL-464 board-authoritative-stage-03
  Scenario: A ticket that has moved to a new stage shows at the new stage only
    Given an active ticket that has moved from one stage to the next
    When the pipeline board is rendered
    Then the ticket appears at the new stage
    And it does not also appear at the previous stage

  # BL-464 board-authoritative-stage-04
  Scenario: The board's active rows come from the authoritative parcel-location source, not an in_process scrape
    Given the authoritative ticket-to-stage source reflects where each active ticket is
    And a ticket is held in a way an in_process git_handoff task-header scrape would miss
    When the pipeline board is rendered
    Then that ticket still appears at its current stage

  # BL-471 board-authoritative-stage-05
  Scenario: A handoff header that leads with a differently-cased ticket id still resolves to its active ticket
    Given an active ticket "BL-447"
    And a role holds a handoff whose header leads with the id "bl-447"
    When the pipeline board is rendered
    Then the ticket appears on the board at that role's stage
    And it appears on exactly one row
