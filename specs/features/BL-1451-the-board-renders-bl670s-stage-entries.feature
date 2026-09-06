Feature: BL-1451 The pipeline board renders BL-670's stage entries, health dot first

  BL-670 made the ticket-stage map {ticket -> {stage, status, asOf, healthDot}}
  and proved the derivation: every scenario drives readTicketStageMap and the
  bb side, and the health-dot scenario asserts the entry's colour. Nothing
  renders it. The board's only input is roleHeldTickets, a bare role-to-ids
  record; the live grid inverts the map back into that shape and the tick's
  production adapter derives the same shape from the mailboxes, so asOf and
  healthDot never reach computePipelineBoard and no dot has ever appeared on
  the board. BL-670's invariant 2 (one derivation, two consumers) has one
  consumer. Found by BL-940's coder on 2026-09-06, whose elapsed-time mark
  assumed the plumbing existed. This feature is that the tick hands the
  board the entries, the board's rows carry them, and the health dot renders
  on the ticket's caption line - outside the fixed-width stage cells, so
  BL-585's width budget stands.

  Background:
    Given a ticket-stage map in BL-670's shape and the tickets it names held by roles

  # BL-1451 the-health-dot-renders-on-the-caption-line-01
  Scenario Outline: a ticket whose stage entry carries a health dot renders it at the head of its caption line
    Given the ticket's entry carries the health dot <colour>
    When the board is computed and rendered
    Then the ticket's caption line begins with <glyph>
    And the ticket's stage cells are unchanged

    Examples:
      | colour | glyph |
      | green  | 🟢    |
      | yellow | 🟡    |
      | red    | 🔴    |

  # BL-1451 no-entry-renders-as-today-02
  Scenario Outline: a ticket with no usable entry renders exactly as today
    Given the ticket's entry is <entry>
    When the board is computed and rendered
    Then the ticket's caption line begins with its display id
    And the grid line width is unchanged

    Examples:
      | entry            |
      | absent           |
      | without a dot    |

  # BL-1451 rows-carry-the-entry-03
  Scenario: every mapped ticket's board row carries its entry's status and as-of time
    When the board is computed
    Then each row for a mapped ticket carries the entry's status and as-of time
    And a row for an unmapped ticket carries neither
