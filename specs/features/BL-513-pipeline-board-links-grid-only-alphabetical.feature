Feature: the pipeline board LINKS section links every shown ticket to its current folder, most-recent-first

  # AMENDED 2026-07-18 (twice). Original: "grid-only, alphabetical." Human directives:
  #  (1) "in the LINKS section, put only the YAMLs for the tickets shown on the message" — every ticket the
  #      board renders (grid PLUS the parked / recently-closed / root-intake lists), not the grid alone.
  #  (2) "the links point to the yamls in the wrong places (tickets might be active or done, not paused)"
  #      -> "Current folder, all shown links": each link resolves to the ticket's ACTUAL current folder.
  #  (3) "i want the most recent tickets at the top as the ordering" — REVERSED the earlier "alphabetical"
  #      reading. Order stays MOST-RECENT-FIRST (highest ticket number first, numeric-aware), which is
  #      BL-506's existing behaviour — so THIS ticket does NOT change the order and does NOT retire BL-506.
  #
  # Net change over BL-506: PATH-correctness + FRESHNESS only. The link SET (all four sources) and the
  # ORDER (most-recent-first) are BL-506's, unchanged. BL-506's feature remains the ordering contract; this
  # feature covers the current-folder path resolution and the re-post-on-path-change freshness.
  #
  # Verified live layer (grep before editing; layers may have moved):
  #  - pipelineBoard.ts buildLinks keeps all four link sources AND keeps compareLinksMostRecentFirst
  #    (do NOT change the comparator). linkPathFor + PipelineBoardTicketMeta.location gain a 'done' case.
  #  - conciergeTick.ts buildTicketMetaLookup makes active AUTHORITATIVE over paused for a duplicated id
  #    and adds a done pass (folders.done already loaded each tick).
  #  - pipelineBoardSync.ts folds the link paths into the content signature (reversing BL-462's exclusion)
  #    so a link-path change re-posts the pinned board instead of being skipped-unchanged.

  Background:
    Given a repo base url is configured so the board renders tappable ticket links

  # BL-513 pipeline-board-links-all-shown-01
  Scenario: LINKS link every ticket shown on the board message, across all sources
    Given the board grid shows tickets "BL-504", "BL-493"
    And a parked ticket "BL-260" shown on the board
    And a recently-closed ticket "BL-101" shown on the board
    And a root-intake item "INTAKE-2026-07-18" shown on the board
    When the pipeline board links are rendered
    Then every shown ticket has a link
    And "BL-504", "BL-493", "BL-260", "BL-101" and "INTAKE-2026-07-18" all have links

  # BL-513 pipeline-board-links-current-folder-03
  Scenario Outline: a link resolves to the folder the ticket is actually in
    Given a shown ticket "<id>" whose backlog file is in the "<folder>" folder
    When the pipeline board links are rendered
    Then its link path is "<path>"

    Examples:
      | id                 | folder | path                              |
      | BL-540             | active | backlog/active/BL-540.yaml        |
      | BL-260             | paused | backlog/paused/BL-260.yaml        |
      | BL-101             | done   | backlog/done/BL-101.yaml          |
      | INTAKE-2026-07-18  | root   | backlog/INTAKE-2026-07-18.md      |

  # BL-513 pipeline-board-links-authoritative-folder-04
  Scenario: a stale cross-folder duplicate links to the authoritative folder, not the stale copy
    Given a shown ticket "BL-540" whose backlog file is in the "active" folder
    And a stale duplicate of "BL-540" is left behind in the "paused" folder
    When the pipeline board links are rendered
    Then its link path is "backlog/active/BL-540.yaml"

  # BL-513 pipeline-board-links-freshness-05
  Scenario: the pinned board re-posts when a shown ticket's link path changes but its body does not
    Given the board was last posted with "BL-540" linked at "backlog/paused/BL-540.yaml"
    And "BL-540" has since moved to the "active" folder with no other visible change to the board body
    When the board sync runs on the next tick
    Then the board is re-posted rather than skipped as unchanged
    And "BL-540" is now linked at "backlog/active/BL-540.yaml"
