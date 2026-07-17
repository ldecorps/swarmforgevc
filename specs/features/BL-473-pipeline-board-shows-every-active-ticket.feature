Feature: The pipeline board shows every ticket physically in backlog/active/, marking a not-yet-held one as not started rather than dropping it

  # BL-473 (bug, human-requested — ldecorps 2026-07-16, direct): "show as active the BL ticket
  # physically sitting in the active backlog folder. that's easy to do. if their position in the swarm
  # is not known, it's a bug to fix. but at a minimum, the pipeline board should be as good as the PWA
  # for displaying active tickets."
  #
  # RESIDUAL GAP after BL-464: BL-464 pointed the board's active rows at an AUTHORITATIVE ticket->stage
  # map (.swarmforge/board/ticket-stage-map.json, written by the coordinator, read via
  # extension/src/swarm/swarmState.ts). But that map only carries a ticket whose stage RESOLVES to a
  # role — swarmforge/scripts/pipeline_stage_cli.bb's filter-active drops any active id it cannot join
  # to an in_process handoff, and extension/src/concierge/pipelineBoard.ts computePipelineBoard builds
  # rows ONLY from that role-held map. So a ticket physically in backlog/active/ that no role holds
  # (freshly promoted and not yet dequeued, or momentarily between two stages) produces NO row and
  # VANISHES — exactly the case BL-471's own correction had judged "correct behaviour". The human is
  # overriding that judgement: physical membership in backlog/active/ is ground truth for "what is
  # active"; the stage map only DECORATES a row's position.
  #
  # THE CONTRACT: the board's active row SET is exactly the tickets whose files sit in backlog/active/.
  # Each row's stage is its authoritative stage when known; a ticket no role currently holds renders in
  # a distinct NOT-STARTED state (human's chosen realisation 2026-07-16: a "?" marker, or a dedicated
  # "not started" column on the right-hand side — exact glyph/header/placement is a build-time cosmetic
  # detail, not a promotion gate). A not-started ticket is never marked at any pipeline role stage, and
  # is never dropped.
  #
  # Scope (grep-confirm the live path at build):
  #   - extension/src/concierge/pipelineBoard.ts computePipelineBoard: build one row for EVERY active
  #     ticket id (a new membership input = the physical backlog/active/ set), placing its X from the
  #     role-held map and defaulting to the not-started state when the map has no stage for it. Keep the
  #     one-row-per-ticket guarantee (BL-464) and the render pure/testable.
  #   - extension/src/concierge/conciergeTick.ts syncBoardIfWired: it already loads folders.active — feed
  #     those ids in as the membership set (recommended seam; folders.active is ground truth independent
  #     of the bb map's completeness). Alternatively pipeline_stage_cli.bb could emit a not-started
  #     sentinel for every unresolved active ticket — build choice, as long as the observable contract
  #     below holds.
  #   - INHERITED and unchanged (BL-452/455/462/464): READ-ONLY board; edge-triggered on rendered
  #     content; deterministic ordering; epic grouping; Telegram API + tmux stay the untested boundary.
  #
  # Sequencing: edits pipelineBoard.ts / conciergeTick.ts — the standing-topic/board overlap cluster.
  # Serialize against every in-flight board ticket (BL-465 render, BL-468 post-before-delete, BL-471
  # id-casing, and paused BL-467 pin); build on whatever board scaffolding is on main at build time.
  #
  # E2E QA PROCEDURE: on the real Telegram board, promote a ticket into backlog/active/ that no role has
  # dequeued yet and confirm it appears as an active row in the NOT-STARTED state (not absent, not marked
  # at a stage); then have a role pick it up and confirm the same ticket moves to that role's stage. Cross
  # the board's active-row count against `ls backlog/active/*.yaml` and confirm they match one-for-one.
  # Verify against the real surface, not a fixture (BL-335).

  Background:
    Given the pipeline board is wired

  # BL-473 board-active-membership-01
  Scenario: A held active ticket still appears at its role's stage
    Given an active ticket that a role currently holds
    When the pipeline board is rendered
    Then the ticket appears on the board at that role's stage

  # BL-473 board-active-membership-02
  Scenario: An active ticket no role holds appears in the not-started state
    Given a ticket physically in backlog/active/ that no role currently holds
    When the pipeline board is rendered
    Then the ticket appears on the board in the not-started state
    And it is not marked at any pipeline role stage

  # BL-473 board-active-membership-03
  Scenario: Every file in backlog/active/ is a board row exactly once
    Given the tickets physically in backlog/active/
    When the pipeline board is rendered
    Then each of those tickets appears on exactly one active row
    And no active row exists for a ticket absent from backlog/active/

  # BL-473 board-active-membership-04
  Scenario: A not-started ticket picked up by a role moves to that stage
    Given a not-started active ticket
    And a role then begins holding it
    When the pipeline board is rendered
    Then the ticket appears on the board at that role's stage
    And it no longer appears in the not-started state
