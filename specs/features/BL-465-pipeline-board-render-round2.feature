# mutation-stamp: sha256=f6ef9d7eb51bb64310d566b014326c377d5e9df6e6467ce5c2b4b9172be55fd9
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-17T01:47:11.382336550Z","feature_name":"The pipeline board shows wider descriptions, distinct sections for parked/paused/intake/recently-closed, and a GitHub link list below the grid","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-465-pipeline-board-render-round2.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":1,"name":"A below-grid list entry leads with the kebab slug then shows more of its title","scenario_hash":"187938b2fcc9e46946fc2b4d270581bad2ac72aeee3cef0f82833f7c5734cb2d","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-17T00:47:31.105421687Z"},{"index":3,"name":"The board lists parked, awaiting-approval, paused, root-intake, and recently-closed items in their own sections","scenario_hash":"56cc1e448bc942e250848e6b7f52433ecb2f62f0e069ca1d207ff950b8f7cd72","mutation_count":5,"result":{"Total":5,"Killed":5,"Survived":0,"Errors":0},"tested_at":"2026-07-17T00:47:31.105421687Z"}]}
# acceptance-mutation-manifest-end

Feature: The pipeline board shows wider descriptions, distinct sections for parked/paused/intake/recently-closed, and a GitHub link list below the grid

  # BL-465 (feature, human via the Operator front desk 2026-07-16,
  # INTAKE-operator-question-1784230021148). Follow-on rendering refinements to the BL-452/BL-455/BL-462
  # pipeline board, from the human's clarifications (he reads it mainly in LANDSCAPE, so more horizontal
  # width is fine):
  #   1. Each ticket entry LEADS with a short kebab slug (2-3 words, derived from the ticket's backlog
  #      filename slug, e.g. BL-467-pipeline-board-only-pin -> "pipeline-board-only-pin"). In the aligned
  #      stage GRID this fills the dedicated SLUG column and the grid carries the slug ONLY (human's
  #      instruction 2026-07-16: "add the slug back to the grid — room enough for 2 or 3 words"; the grid
  #      has no title column, its width is spent on the 8 stage columns). In the BELOW-GRID lists the
  #      entry leads with the same slug THEN fills the remaining landscape width with more of the
  #      truncated title (human's decision 2026-07-16: "both: slug + wider title"), refining the earlier
  #      "show more of the description" ask. Exact kebab word-count and column width are build-time
  #      cosmetic details, not a promotion gate.
  #   2. Drop the redundant per-line "PK" label in the parked list (the section already says it is
  #      parked); keep the awaiting-approval distinction by giving it its OWN "AWAITING APPROVAL:"
  #      section (no per-line "AA" label either) — human's decision 2026-07-16.
  #   3. Add the PAUSED backlog items and the ROOT-INTAKE items (raw backlog/ root asks) as their own
  #      sections alongside the parked area.
  #   4. Add a RECENTLY-CLOSED section.
  #   5. Hyperlink each ticket id (grid rows, the parked/paused/intake sections, and recently-closed) to
  #      its backlog item on GitHub. Telegram does NOT render links inside a <pre> block, so (human's Q1
  #      choice) the links ride a TAPPABLE LINK LIST BELOW the grid, leaving the aligned monospace grid
  #      intact. Base URL derives from the origin remote (https://github.com/ldecorps/swarmforgevc);
  #      link an active ticket to backlog/active/<file>, a paused one to backlog/paused/<file>, a closed
  #      one to backlog/done/<file>.
  #
  # Scope (grep-confirm at build): extension/src/concierge/pipelineBoard.ts (render: widen the slug in
  # the grid AND the below-grid lists; drop the PK label; add distinct parked / paused / root-intake /
  # recently-closed sections; emit a below-grid link list keyed by ticket id) and its caller
  # extension/src/concierge/conciergeTick.ts (supply the paused list, the root-intake list, and the
  # recently-closed list, and the repo base URL). Paused / intakes / recently-closed are live local/git
  # data on the LIVE Telegram surface — read them in the tick from the backlog folders + git (they are
  # NOT limited to the git-SHA static PWA projection). Keep the renderer pure/testable; the wider slug
  # stays a single delimiter-safe line (strip newlines). READ-ONLY, edge-triggered, deterministic
  # ordering — all inherited and unchanged.
  #
  # Sequencing: same board files as BL-462 / BL-464 — serialize after them; build on the board
  # scaffolding on main at build time. The exact widened width, section headers, and link-line format
  # are build-time cosmetic details, not a promotion gate.

  # BL-465 board-round2-01
  Scenario: The stage grid's slug column shows a short kebab slug
    Given a long-titled ticket occupies a stage-grid row
    When the pipeline board is rendered
    Then the grid row's slug column shows the ticket's short kebab slug
    And the grid row remains a single aligned line

  # BL-465 board-round2-01b
  Scenario Outline: A below-grid list entry leads with the kebab slug then shows more of its title
    Given a long-titled ticket appears under the "<list>" section
    When the pipeline board is rendered
    Then the "<list>" entry leads with a short kebab slug for the ticket
    And it then shows more of the title than the previous limit allowed
    And the whole entry is still a single line

    Examples:
      | list            |
      | parked list     |
      | recently-closed |

  # BL-465 board-round2-02
  Scenario: The parked list drops the redundant PK label
    Given a parked ticket in the parked section
    When the pipeline board is rendered
    Then the parked entry does not repeat a per-line "PK" label
    And an awaiting-approval ticket is distinguished by its own section, not a per-line label

  # BL-465 board-round2-03
  Scenario Outline: The board lists parked, awaiting-approval, paused, root-intake, and recently-closed items in their own sections
    Given a "<kind>" item exists
    When the pipeline board is rendered
    Then the board shows it under the "<kind>" section

    Examples:
      | kind              |
      | parked            |
      | awaiting-approval |
      | paused            |
      | root-intake       |
      | recently-closed   |

  # BL-465 board-round2-04
  Scenario: A tappable link list below the grid links each ticket id to its GitHub backlog item
    Given active, parked, and recently-closed tickets on the board
    When the pipeline board is rendered
    Then a link list below the grid links each ticket id to its backlog file on GitHub
    And an active ticket links under backlog/active, a paused one under backlog/paused, and a closed one under backlog/done

  # BL-465 board-round2-05
  Scenario: The aligned monospace grid is preserved
    Given the board carries hyperlinks in the link list below the grid
    When the pipeline board is rendered
    Then the stage grid itself remains an aligned monospace block with no links inside it
