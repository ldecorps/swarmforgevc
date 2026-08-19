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
  #
  # SCOPE, per the human's ruling of 2026-08-19: this ticket is the
  # DERIVATION SEMANTICS plus the HEALTH DOT, and nothing else. Every
  # layout concern the original filing carried — one grid with the stage
  # axis rendered once, cell padding to the widest cell, epic as a
  # column-header annotation — belongs to BL-585, which already specifies
  # all of it and which this ticket depends on. The mini-slug row is
  # DROPPED outright under BL-585's ruling #4 (epic-only caption, no slug).
  # The per-ticket legend deep-links moved to their own ticket. See the
  # YAML's notes for the verbatim rulings on both sides.
  #
  # Step handlers drive the real derivation the board reads, never a
  # reimplementation of it. The <status> and <dot colour> columns are
  # validated against explicit KNOWN_VALUES, never passed through.

  # BL-670 in-transit-ticket-never-not-started-01
  Scenario: a ticket in transit renders its last-known stage, never not-started
    Given ticket 647 traversed specifier and coder and its parcel now sits in the cleaner's new/ inbox
    And a stale orphaned night-batch claim with no derivable ticket id also sits in_process
    When the board's ticket stage is derived
    Then ticket 647 derives stage cleaner with status in-transit-to as of 10:11
    And ticket 647 does not derive as not-started

  # BL-670 derivation-status-per-parcel-location-02
  Scenario Outline: each parcel location derives its own stage status
    Given a ticket whose most recent observable parcel is <location>
    When the board's ticket stage is derived
    Then that ticket derives status <status> with an as-of time

    Examples:
      | location                                 | status         |
      | claimed in a role's in_process box       | claimed        |
      | waiting in the next role's new/ inbox    | in-transit-to  |
      | recorded only in the durable sent/ trail | last-known     |

  # BL-670 one-derivation-two-consumers-03
  Scenario: the completion ring and the board read the same derivation
    Given a ticket whose stage is derived from the durable handoff trail
    When both the board and the completion ring read that ticket's stage
    Then they report the same stage, status and as-of time

  # BL-670 health-dot-from-bounce-count-04
  Scenario Outline: the health dot reflects the ticket's recorded bounce count
    Given a ticket with <bounce count> recorded bounces
    When its health dot is derived
    Then the dot is <dot colour>

    Examples:
      | bounce count | dot colour |
      | 0            | green      |
      | 2            | yellow     |
      | 3            | red        |

  # BL-670 stage-survives-an-empty-stage-map-05
  Scenario: a ticket already past a stage never regresses to not-started when nothing is claimed
    Given every role's in_process and new/ boxes are empty
    And the durable sent/ trail records the ticket forwarded to the documenter
    When the board's ticket stage is derived
    Then that ticket derives stage documenter with status last-known
