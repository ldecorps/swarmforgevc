Feature: the pipeline board grid renders compactly and orders its columns for a phone

  # Root intake 2026-07-17 (backlog/INTAKE-pipeline-board-grid-too-wide.md) - a request the
  # human made looking at a live board render: "We have to save space on the grid, it does not
  # fit on the one [screen]. Only keep the digit of the ticket and/or shorten even more the
  # kebab case slug." Human decisions (specifier asked 2026-07-17): (a) narrow BOTH the grid's
  # own columns AND the below-grid list lines; (b) shorten the grid slug from 3 kebab words to 2.
  # A follow-up ask the same day (direct to the specifier): (c) move the not-started (NS) column
  # to be the FIRST stage column instead of the last - a deliberate reversal of the human's own
  # 2026-07-16 "not started column on the right-hand side" preference that BL-473 encoded; BL-473
  # itself declared that placement "a build-time cosmetic detail, not a promotion gate", and every
  # existing NS assertion locates the column by name via indexOf (never a fixed position), so this
  # reorder breaks no test.
  #
  # This REVERSES the widening direction of BL-462 (slug bound 24 -> 40, "longer slug") and
  # BL-465 (3-word grid slug + a wide-title list tail up to 60 chars). Their now-superseded
  # acceptance assertions and their step handlers - plus the unit tests that pin the old widths -
  # must be revised in THIS SAME parcel (BL-233: scenarios and their handlers land together, or
  # the acceptance runner hard-fails; and a feature edit committed to main WITHOUT its handler
  # change breaks the runner for every role mid-flight). See the ticket SCOPE for the known sites.
  #
  # Observable contract:
  #  1. The grid TICKET column shows the ticket NUMBER only - a recognised BL-/GH- prefix is
  #     stripped (BL-493 -> 493). An id with no recognised ticket prefix (a root-intake filename
  #     stem) is shown unchanged. The column header is a short label so the column is no wider
  #     than the numbers themselves (never the 6-char word "TICKET").
  #  2. The grid SLUG column shows at most TWO kebab-case words of the title (was three).
  #  3. Each below-grid list line (PARKED / AWAITING APPROVAL / ROOT INTAKE / RECENTLY CLOSED)
  #     shows the short kebab slug ONLY - the wide title tail BL-465 appended is dropped - and a
  #     real ticket id there is rendered number-only the same way the grid's is.
  #  4. The not-started (NS) column is the FIRST stage column (immediately after TICKET and SLUG,
  #     before the specifier/SP column), not the last - a one-line reorder of
  #     PIPELINE_BOARD_COLUMN_ORDER. Header, row marks, and the below-grid sections are otherwise
  #     unchanged.
  # The LINKS section is OUT of scope here (its width is already budgeted by BL-502, and its
  # ordering is BL-506's separate concern) and is left unchanged. The exact header glyph is a
  # build-time/cosmetic detail (BL-452's column-glyph precedent), not pinned by these scenarios.

  # BL-505 pipeline-board-narrower-grid-and-lists-01
  Scenario Outline: the grid ticket column shows the ticket number without its prefix
    Given a grid row for ticket "<id>"
    When the pipeline board is rendered
    Then the ticket column for that row shows "<displayed>"

    Examples:
      | id     | displayed |
      | BL-493 | 493       |
      | GH-42  | 42        |

  # BL-505 pipeline-board-narrower-grid-and-lists-02
  Scenario Outline: the grid slug column shows at most two kebab words of the title
    Given a grid row whose ticket title is "<title>"
    When the pipeline board is rendered
    Then the slug column for that row shows "<slug>"

    Examples:
      | title                                        | slug           |
      | Pipeline board shows a lot more of the title | pipeline-board |
      | Stop                                         | stop           |

  # BL-505 pipeline-board-narrower-grid-and-lists-03
  Scenario: the ticket column is no wider than the ticket numbers it contains
    Given grid rows for tickets "BL-493" and "BL-504"
    When the pipeline board is rendered
    Then the ticket column is 3 characters wide

  # BL-505 pipeline-board-narrower-grid-and-lists-04
  Scenario: a below-grid list line shows the short kebab slug only and a number-only id
    Given a parked ticket "BL-472" titled "Pipeline board shows a lot more of the title now"
    When the pipeline board is rendered
    Then the parked entry for that ticket shows id "472" and slug "pipeline-board"
    And the parked entry does not include any further words of the title

  # BL-505 pipeline-board-narrower-grid-and-lists-05
  Scenario: a root-intake list entry keeps its non-ticket id unchanged
    Given a root-intake entry "INTAKE-pipeline-board-grid" titled "grid too wide"
    When the pipeline board is rendered
    Then the root intake entry's id is shown unchanged as "INTAKE-pipeline-board-grid"

  # BL-505 pipeline-board-narrower-grid-and-lists-06
  Scenario: the not-started column leads the stage columns instead of trailing them
    Given a grid row for a not-started ticket "BL-503"
    When the pipeline board is rendered
    Then the "NS" column is the first stage column, before "SP"
    And the not-started ticket's mark falls in that first stage column
