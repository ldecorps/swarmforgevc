Feature: The pipeline board groups tickets by epic, lists parked tickets below the grid, and shows a slug per ticket

  # BL-455 (feature, human-requested via Telegram SUP-7, relayed by the Operator 2026-07-16, PRIORITIZED):
  # three refinements to the shipped BL-452 pipeline board (the monospace kanban grid edited in place in the
  # dedicated Pipeline Board Telegram topic). Today the board renders one flat row per active ticket keyed by
  # bare ticket id, with parked / awaiting-approval tickets appearing as ordinary grid rows in dedicated
  # status COLUMNS. This ticket: (1) GROUPS the ticket rows BY EPIC; (2) takes PARKED and awaiting-approval
  # tickets OUT of the grid and lists them SEPARATELY BELOW it; (3) adds a short SLUG per ticket derived from
  # the ticket title.
  #
  # Scope (live paths verified 2026-07-16): the pure renderer computePipelineBoardRows / renderPipelineBoard
  # in extension/src/concierge/pipelineBoard.ts (a PipelineBoardRow is { id, column } today — widen it to
  # carry epic + title, slug derived from title), wired from syncBoardIfWired in
  # extension/src/concierge/conciergeTick.ts (join held-ticket ids to BacklogItem.epic/.title via
  # extension/src/panel/backlogReader.ts; no git-history walk). RECONCILE the BL-452 acceptance in the same
  # parcel: the parked/awaiting-approval grid COLUMNS are removed, so BL-452's pipeline-board-02 parked rows
  # and specs/pipeline/steps/bl452PipelineBoardSteps.js must move to asserting the below-grid list (the
  # acceptance runner throws on a scenario whose handler no longer matches the rendered shape, BL-233).
  #
  # INHERITED from BL-452 and unchanged: READ-ONLY / side-effect-free; ONE message edited in place in ONE
  # topic; EDGE-TRIGGERED on rendered-text change (never edit on an unchanged tick — anti-storm 429 rule).
  # Grouping + the parked list must be deterministic (fixed epic + ticket ordering) so the edge-trigger text
  # comparison stays stable. Every active ticket lands in exactly ONE place: a stage cell in its epic group,
  # or the below-grid parked/awaiting list — never both, never neither.

  # BL-455 pipeline-board-epic-01
  Scenario: Ticket rows are grouped by epic
    Given active tickets belong to different epics
    And some active tickets belong to no epic
    When the pipeline board is rendered
    Then tickets that share an epic are grouped together under that epic
    And tickets with no epic are grouped together

  # BL-455 pipeline-board-epic-02
  Scenario Outline: A ticket in a given state appears in exactly one place on the board
    Given ticket "<id>" is "<state>"
    When the pipeline board is rendered
    Then ticket "<id>" appears in the "<placement>"

    Examples:
      | id     | state             | placement                    |
      | BL-387 | held by the coder | stage grid                   |
      | BL-436 | parked            | below-grid parked list       |
      | BL-449 | awaiting approval | below-grid parked list       |

  # BL-455 pipeline-board-epic-03
  Scenario: Parked and awaiting-approval tickets are not stage-grid rows
    Given a parked ticket and an awaiting-approval ticket
    When the pipeline board is rendered
    Then neither ticket appears as a row inside the stage grid
    And both tickets appear in the parked list below the grid

  # BL-455 pipeline-board-epic-04
  Scenario: Each ticket row shows a short slug derived from its title
    Given an active ticket with a title
    When the pipeline board is rendered
    Then the ticket's row shows a short slug derived from its title
    And the slug is a single line no wider than the board

  # BL-455 pipeline-board-epic-05
  Scenario: A ticket held by a role is still marked in that role's column within its epic group
    Given a ticket held by the coder
    When the pipeline board is rendered
    Then the ticket is marked in the coder column
    And the ticket appears under its own epic group

  # BL-455 pipeline-board-epic-06
  Scenario: Rendering the board modifies no swarm state
    Given active tickets span several epics and stages
    When the pipeline board is rendered
    Then no ticket, handoff, or backlog state is modified by the board
