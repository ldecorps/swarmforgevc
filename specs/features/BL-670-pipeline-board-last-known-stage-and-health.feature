Feature: pipeline board shows last-known stage, never renders in-transit as not-started

  # BL-670, supersedes BL-573: the board's ticket-stage map derives a stage
  # only while a task-bearing parcel is CLAIMED (in_process) — a parcel in
  # new/ (in transit, a large fraction of a ticket's life under depth-1
  # rotation) derives nothing, so an in-transit ticket renders not-started.
  # Observed: BL-647 had traversed specifier and coder and sat at the
  # cleaner, but the board showed it not-started because
  # ticket-stage-map.json read {} — aggravated by a stale orphaned
  # night-batch claim with no derivable ticket id. The human's verbatim
  # requirement: "chaque ticket dans sa colonne, avec l'agent en cours, OU
  # LE DERNIER CONNU."

  Background:
    Given the board derives stage as claimed, in-transit-to, or last-known from the durable handoff trail

  # BL-670 in-transit-ticket-never-not-started-01
  Scenario: a ticket in transit renders its last-known stage, never not-started
    Given ticket 647 traversed specifier and coder and its parcel now sits in the cleaner's new/ inbox
    And a stale orphaned night-batch claim with no derivable ticket id also sits in_process
    When the pipeline board renders
    Then ticket 647 shows "cleaner (in transit) · as of 10:11"
    And ticket 647 does not render as not-started

  # BL-670 claimed-ticket-shows-current-agent-02
  Scenario: a claimed ticket shows its current agent and status
    Given a ticket's parcel is in_process at the architect
    When the pipeline board renders
    Then that ticket's column shows stage architect with status claimed

  # BL-670 last-known-from-durable-trail-03
  Scenario: a ticket with no claimed or in-transit parcel shows its last-known stage from the handoff trail
    Given a ticket has no in_process or new/ parcel anywhere
    And the durable sent/ handoff trail last shows it forwarded to the documenter
    When the pipeline board renders
    Then that ticket's column shows stage documenter with status last-known and its as-of time

  # BL-670 grid-alignment-invariant-04
  Scenario: every cell is padded to its column's widest cell
    Given a board render where one ticket's stage mark is "X(34m)" and another column's marks are shorter
    When the pipeline board renders
    Then every cell in that column is padded to the widest cell's width
    And no mark shears the grid

  # BL-670 one-grid-epic-as-annotation-05
  Scenario: epic grouping is a column-header annotation, never a second stage axis
    Given active tickets from more than one epic
    When the pipeline board renders
    Then the stage axis is rendered once as rows
    And epic membership appears only as a column-header annotation, not as a second stacked board

  # BL-670 health-dot-from-bounce-count-06
  Scenario Outline: the health dot reflects the ticket's bounce count
    Given a ticket with <bounce count> recorded bounces
    When the pipeline board renders
    Then that ticket's column shows a <dot color> health dot

    Examples:
      | bounce count | dot color |
      | 0             | green      |
      | 2             | yellow     |
      | 3             | red        |

  # BL-670 mini-slug-and-legend-links-07
  Scenario: a mini-slug row and an outside-code-block legend line carry the deep links
    Given a ticket column with its id and title
    When the pipeline board renders
    Then a truncated mini-slug row appears under the id row inside the code block
    And a legend line outside the code block links to the ticket's own BL topic
    And that legend line links to the Knowledge Explorer gherkin view when available, or omits it gracefully otherwise

  # BL-670 supersedes-bl-573-08
  Scenario: BL-573 retires as superseded by this ticket's semantics
    Given BL-573 named only the in_process-only half of this derivation gap
    When this ticket's semantics land
    Then BL-573 is retired to backlog/done/ as superseded, not carried as a duplicate
