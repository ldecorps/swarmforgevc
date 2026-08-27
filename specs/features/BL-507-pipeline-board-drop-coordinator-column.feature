Feature: The pipeline board grid drops the Coordinator column; a coordinator-held ticket is marked at the QA stage instead

  # BL-507 (human-requested — ldecorps 2026-07-17, direct: "take the Coordinator column out"): the
  # Telegram Pipeline Board grid currently renders one column per role in ALL_SWARM_ROLES, which appends
  # 'coordinator' to the seven-role forward PIPELINE_CHAIN (extension/src/concierge/roleTopicMapStore.ts).
  # So the grid header carries a Coordinator column (glyph "CD") after QA. The coordinator is NOT a
  # forward pipeline stage — it does post-QA backlog bookkeeping only (PIPELINE.md, BL-247) — so it does
  # not belong among the parcel-flow stages the board shows. Remove it.
  #
  # THE CONTRACT (behaviour pinned; exact glyphs/placement remain a build-time cosmetic detail per
  # BL-452/BL-473's own column-glyph precedent):
  #   1. The grid shows a column for every forward pipeline stage (specifier..QA) plus the not-started
  #      (NS) sentinel, and NO coordinator column.
  #   2. A ticket physically in backlog/active/ whose authoritative stage is the coordinator — the brief
  #      post-QA bookkeeping window after QA has approved and landed the commit but before the coordinator
  #      moves the file to backlog/done/ — is marked in the QA column (human decision 2026-07-17: it has
  #      cleared the pipeline, so it reads at the end-of-line stage, not blank and not not-started).
  #   3. Every existing behaviour is otherwise unchanged: a held ticket still marks exactly its own stage,
  #      a not-started ticket still marks only NS, membership is still exactly backlog/active/ (BL-473),
  #      ordering/epic-grouping deterministic, board READ-ONLY and edge-triggered.
  #
  # Scope (grep-confirm the live path at build):
  #   - extension/src/concierge/pipelineBoard.ts: build PIPELINE_BOARD_COLUMN_ORDER from the forward
  #     PIPELINE_CHAIN (specifier..QA) + the not-started sentinel, NOT from ALL_SWARM_ROLES — so
  #     'coordinator' is no longer a grid column. Do NOT touch ALL_SWARM_ROLES itself: it still drives the
  #     coordinator's own steering topic in roleTopicMapStore.ts (BL-425, "all 8 roles"); this change is
  #     the board's column set only. In buildGridRows, collapse a coordinator-held row's stage to 'QA'
  #     before it renders (heldRoleByTicketId still iterates ALL_SWARM_ROLES, so a coordinator-held id
  #     resolves to 'coordinator' and must be remapped to QA here — otherwise its X would render nowhere,
  #     an all-dots row). COLUMN_LABEL['coordinator'] = 'CD' becomes unused (cleaner may remove it after a
  #     grep). See the ticket notes for the BL-505 sequencing (same PIPELINE_BOARD_COLUMN_ORDER line).
  #   - specs/pipeline/steps/bl452PipelineBoardSteps.js: add a "held by the coordinator" KNOWN_STATES
  #     entry (setRoleHeldTickets({ coordinator: [id] })); drop 'coordinator' from KNOWN_COLUMNS (no
  #     scenario asserts a coordinator column any more). Fix the cosmetic test name at
  #     extension/test/pipelineBoard.test.js:33 ("specifier..coordinator" -> "specifier..QA").
  #
  # E2E QA PROCEDURE: on the real Telegram board (or an in-process render over the live backlog), confirm
  # the grid header no longer shows a Coordinator ("CD") column and still shows every specifier..QA stage
  # plus NS; then render a synthetic board where one active ticket is held by the coordinator and confirm
  # its row is marked under QA (a single X, in the QA column, not blank, not NS). Verify against the real
  # surface, not only a fixture (BL-335). Cross the header/data-row column counts to confirm they stay
  # aligned (no orphaned cell left where CD used to be).

  Background:
    Given the pipeline board is wired

  # BL-507 board-drop-coordinator-01
  Scenario: The rendered grid has no coordinator column
    When the pipeline board is rendered
    Then the board grid has no coordinator column

  # BL-507 board-drop-coordinator-02
  Scenario: The grid still shows every forward pipeline stage and the not-started column
    When the pipeline board is rendered
    Then the board grid has a column for every forward pipeline stage from specifier to QA
    And the board grid has a not-started column

  # BL-507 board-drop-coordinator-03
  Scenario: A coordinator-held active ticket is marked at the QA stage
    Given an active ticket the coordinator currently holds
    When the pipeline board is rendered
    Then the ticket is marked only in the QA column
    And the board grid has no coordinator column
